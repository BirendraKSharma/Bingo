import React from 'react';
import Bingo from './bingo';
import Confetti from 'react-confetti';

/*
Room-based Multiplayer Bingo Component
Features:
- Enter player name
- Create or Join room by code
- Persists name & last room in sessionStorage (per tab)
- Connects to WS /ws/{room_id}
- Syncs state via REST GET /state/{room_id} on (re)join
- Broadcasts mark_number, winner, reset within room
*/

// ---------------------------------------------------------------------------
// Endpoint configuration (derives sensible defaults in production)
// ---------------------------------------------------------------------------
// If Vercel build did not inject env vars, attempt to derive from window.location.
// This allows deploying frontend + backend under same origin (via reverse proxy) OR
// different origins when explicitly configured.
let derivedApiBase;
try {
  if (typeof window !== 'undefined') {
    derivedApiBase = window.location.origin.replace(/\/$/, '');
  }
} catch (_) { /* no-op (SSR safety) */ }

let RAW_API_BASE = import.meta.env.VITE_API_URL || derivedApiBase || 'http://localhost:8000';
// If we are on an https page but RAW_API_BASE is http pointing to same hostname (or likely forgot https), attempt auto-upgrade.
if (typeof window !== 'undefined' && window.location.protocol === 'https:' && /^http:\/\//i.test(RAW_API_BASE)) {
  try {
    const apiUrl = new URL(RAW_API_BASE);
    // If host matches current host OR user is clearly hitting a remote host that also supports https, upgrade protocol.
    // This is heuristic; backend must actually have TLS (Render provides https by default).
    RAW_API_BASE = 'https://' + apiUrl.host + apiUrl.pathname.replace(/\/$/, '');
  } catch (_) { /* ignore parse errors */ }
}
// Normalize (strip trailing slash)
const API_BASE = RAW_API_BASE.replace(/\/$/, '');

// Derive WS base if not explicitly provided. Replace protocol (http->ws, https->wss) and append /ws
function deriveWsBase(apiBase) {
  if (!apiBase) return 'ws://localhost:8000/ws';
  if (apiBase.startsWith('https://')) return apiBase.replace(/^https:\/\//, 'wss://') + '/ws';
  if (apiBase.startsWith('http://')) return apiBase.replace(/^http:\/\//, 'ws://') + '/ws';
  // Already something custom (maybe wss://) – assume caller gave full base; ensure /ws suffix
  return apiBase.endsWith('/ws') ? apiBase : apiBase + '/ws';
}

const WS_BASE = (import.meta.env.VITE_WS_URL_BASE || deriveWsBase(API_BASE)).replace(/\/$/, ''); // final URL = `${WS_BASE}/${roomId}`
if (typeof window !== 'undefined' && !import.meta.env.PROD) {
  // Helpful console diagnostics during development
  // eslint-disable-next-line no-console
  console.log('[Config] API_BASE:', API_BASE, 'WS_BASE:', WS_BASE);
}

// --- Deterministic board generation (seeded by roomId + playerName) ---
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return h >>> 0; // unsigned 32-bit
}

function xorshift32(seed) {
  let x = seed >>> 0;
  return function next() {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return (x >>> 0) / 4294967296; // 0..1
  };
}

function generateDeterministicCard(roomId, playerName) {
  if (!roomId || !playerName) return [];
  const seed = hashString(`${roomId}|${playerName}`);
  const rand = xorshift32(seed);
  const nums = Array.from({ length: 25 }, (_, i) => i + 1);
  for (let i = nums.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  return nums.map((v, idx) => ({ value: v, isHeld: false, id: idx }));
}

export default function RoomMultiplayerBingo() {
  const socketRef = React.useRef(null);
  const [playerName, setPlayerName] = React.useState(() => sessionStorage.getItem('playerName') || '');
  const [nameInput, setNameInput] = React.useState(playerName);
  const [roomId, setRoomId] = React.useState(() => sessionStorage.getItem('roomId') || '');
  const [roomInput, setRoomInput] = React.useState(roomId);
  const [creatingRoom, setCreatingRoom] = React.useState(false);
  const [players, setPlayers] = React.useState([]);
  const [card, setCard] = React.useState([]); // will be set deterministically once room & player known
  const [numbersDrawn, setNumbersDrawn] = React.useState(new Set());
  const [winner, setWinner] = React.useState(null);
  const [status, setStatus] = React.useState('idle'); // idle|connecting|connected|error|disconnected
  const [errorMsg, setErrorMsg] = React.useState('');
  const [hasInteracted, setHasInteracted] = React.useState(false);
  // Turn-based state
  const [turnOrder, setTurnOrder] = React.useState([]); // array of player names
  const [currentPlayer, setCurrentPlayer] = React.useState(null);
  const [phase, setPhase] = React.useState('waiting'); // waiting | active | finished
  const [lastInvalid, setLastInvalid] = React.useState(null); // { reason, at }

  const isWinner = winner === playerName;

  // Derived board update from numbers drawn (makes newly drawn numbers highlight)
  React.useEffect(() => {
    if (card.length === 25) {
      setCard(prev => prev.map(cell => numbersDrawn.has(cell.value) ? { ...cell, isHeld: true } : { ...cell, isHeld: false }));
    }
  }, [numbersDrawn]);

  // Initialize deterministic board when ready
  React.useEffect(() => {
    if (roomId && playerName && card.length === 0) {
      const base = generateDeterministicCard(roomId, playerName);
      setCard(base.map(c => numbersDrawn.has(c.value) ? { ...c, isHeld: true } : c));
    }
  }, [roomId, playerName]);

  // Connect WebSocket when playerName and roomId are present
  React.useEffect(() => {
    if (!playerName || !roomId) return;

    let ws; // local reference
    let reconnectTimer;
    let attempts = 0;
    const maxAttempts = 5;

    const connect = () => {
      setStatus('connecting');
      ws = new WebSocket(`${WS_BASE}/${roomId}`);
      socketRef.current = ws;

      ws.onopen = () => {
        setStatus('connected');
        attempts = 0;
        // Join message
        ws.send(JSON.stringify({ type: 'join', name: playerName }));
        // Pull authoritative state (in case of reconnection)
        fetch(`${API_BASE}/state/${roomId}`)
          .then(r => {
            if (!r.ok) throw new Error('Failed to fetch state');
            return r.json();
          })
          .then(state => {
            setPlayers(state.players || []);
            setNumbersDrawn(new Set(state.numbers_drawn || []));
            setWinner(state.winner || null);
          })
          .catch(err => console.error('State sync error:', err));
      };

      ws.onmessage = evt => {
        const data = JSON.parse(evt.data);
        switch (data.type) {
          case 'state': // initial push for new join (already also fetching REST)
            if (data.players) setPlayers(data.players);
            if (data.numbers_drawn) setNumbersDrawn(new Set(data.numbers_drawn));
            if (data.winner) setWinner(data.winner);
            if (data.turn_order) setTurnOrder(data.turn_order);
            if (data.current_player !== undefined) setCurrentPlayer(data.current_player);
            if (data.phase) setPhase(data.phase);
            break;
          case 'player_joined':
            if (data.players) setPlayers(data.players);
            if (data.turn_order) setTurnOrder(data.turn_order);
            if (data.current_player !== undefined) setCurrentPlayer(data.current_player);
            if (data.phase) setPhase(data.phase);
            break;
          case 'player_left':
            if (data.players) setPlayers(data.players);
            if (data.turn_order) setTurnOrder(data.turn_order);
            if (data.current_player !== undefined) setCurrentPlayer(data.current_player);
            if (data.phase) setPhase(data.phase);
            break;
          case 'mark_number':
            setNumbersDrawn(prev => new Set(prev).add(data.number));
            break;
          case 'winner':
            setWinner(data.winner);
            if (data.phase) setPhase(data.phase);
            break;
          case 'reset':
            setNumbersDrawn(new Set());
            setWinner(null);
            {
              const base = generateDeterministicCard(roomId, playerName);
              setCard(base);
            }
            if (data.turn_order) setTurnOrder(data.turn_order);
            if (data.current_player !== undefined) setCurrentPlayer(data.current_player);
            if (data.phase) setPhase(data.phase);
            break;
          case 'next_turn':
            if (data.turn_order) setTurnOrder(data.turn_order);
            if (data.current_player !== undefined) setCurrentPlayer(data.current_player);
            break;
          case 'invalid_move':
            setLastInvalid({ reason: data.reason, at: Date.now(), current: data.current_player });
            if (data.current_player !== undefined) setCurrentPlayer(data.current_player);
            break;
          case 'heartbeat_ack':
          default:
            break;
        }
      };

      ws.onerror = e => {
        console.error('WebSocket error', e);
        setStatus('error');
      };

      ws.onclose = () => {
        setStatus('disconnected');
        if (attempts < maxAttempts) {
          attempts += 1;
          reconnectTimer = setTimeout(connect, 2000 * attempts);
        }
      };
    };

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      ws && ws.close();
    };
  }, [playerName, roomId]);

  // Persist name and room id
  React.useEffect(() => {
    if (playerName) sessionStorage.setItem('playerName', playerName);
  }, [playerName]);
  React.useEffect(() => {
    if (roomId) sessionStorage.setItem('roomId', roomId);
  }, [roomId]);

  function handleCreateRoom() {
    setCreatingRoom(true);
    fetch(`${API_BASE}/rooms`, { method: 'POST' })
      .then(r => {
        if (!r.ok) throw new Error('Failed to create room');
        return r.json();
      })
      .then(data => {
        setRoomId(data.room_id);
        setRoomInput(data.room_id);
      })
      .catch(err => {
        // Improve error feedback for common deployment misconfigurations
        let msg = err.message || 'Network error';
        if (msg === 'Failed to fetch') {
          if (typeof window !== 'undefined' && window.location?.protocol === 'https:' && API_BASE.startsWith('http://')) {
            msg = 'Mixed content blocked: auto-upgrade failed. Set VITE_API_URL to https:// (current: ' + API_BASE + ')';
          } else if (API_BASE.includes('localhost')) {
            msg = 'Frontend is deployed but still pointing to localhost. Set VITE_API_URL & VITE_WS_URL_BASE at build time.';
          } else {
            msg += ' (network / CORS / DNS). Check browser console for details.';
          }
        }
        setErrorMsg(msg);
      })
      .finally(() => setCreatingRoom(false));
  }

  function handleJoinRoom() {
    if (!roomInput.trim()) return;
    setRoomId(roomInput.trim().toUpperCase());
  }

  function holdCell(id) {
    if (winner || phase === 'finished') return;
    if (currentPlayer && currentPlayer !== playerName) {
      // Not this player's turn; ignore locally (server will also reject if sent)
      return;
    }
    const cell = card.find(c => c.id === id);
    if (!cell || numbersDrawn.has(cell.value)) return;

    // Optimistic UI
    setNumbersDrawn(prev => new Set(prev).add(cell.value));

    if (socketRef.current?.readyState === 1) {
      socketRef.current.send(JSON.stringify({ type: 'mark_number', number: cell.value }));
    }

    // After marking, check local board for win (client-side convenience) - actual winner broadcast authoritative
    const updatedBoard = card.map(c => c.id === id ? { ...c, isHeld: true } : (numbersDrawn.has(c.value) ? { ...c, isHeld: true } : c));
    if (checkTotalBingos(updatedBoard) && !winner) {
      if (socketRef.current?.readyState === 1) {
        socketRef.current.send(JSON.stringify({ type: 'winner' }));
      }
      setWinner(playerName); // immediate feedback
    }
  }

  function checkTotalBingos(board) {
    let bingoCount = 0;
    for (let i = 0; i < 5; i++) {
      const row = board.slice(i * 5, i * 5 + 5);
      if (row.every(cell => cell.isHeld)) bingoCount++;
    }
    for (let col = 0; col < 5; col++) {
      const column = [];
      for (let row = 0; row < 5; row++) column.push(board[row * 5 + col]);
      if (column.every(cell => cell.isHeld)) bingoCount++;
    }
    const mainDiagonal = [0, 6, 12, 18, 24].map(i => board[i]);
    if (mainDiagonal.every(cell => cell.isHeld)) bingoCount++;
    const antiDiagonal = [4, 8, 12, 16, 20].map(i => board[i]);
    if (antiDiagonal.every(cell => cell.isHeld)) bingoCount++;
    return bingoCount >= 5;
  }

  function handleReset() {
    if (socketRef.current?.readyState === 1) {
      socketRef.current.send(JSON.stringify({ type: 'reset' }));
    }
    setNumbersDrawn(new Set());
    setWinner(null);
    const base = generateDeterministicCard(roomId, playerName);
    setCard(base);
    setPhase('waiting');
    setCurrentPlayer(turnOrder[0] || null);
  }

  const cardElements = card.map(cell => (
    <Bingo
      key={cell.id}
      value={cell.value}
      isHeld={numbersDrawn.has(cell.value)}
      hold={() => holdCell(cell.id)}
      id={cell.id}
      disabled={!!currentPlayer && currentPlayer !== playerName || phase === 'finished'}
    />
  ));

  if (!playerName) {
    return (
      <main className="app-shell centered">
        <div className="panel panel-elevated intro-panel">
          <h1 className="app-title">Multiplayer Bingo</h1>
          <p className="tagline">Pick a name to get started</p>
          <div className="form-stack">
            <input
              className="input text"
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && nameInput.trim()) setPlayerName(nameInput.trim()); }}
              placeholder="Your name"
              autoFocus
            />
            <button className="btn primary" disabled={!nameInput.trim()} onClick={() => setPlayerName(nameInput.trim())}>Continue</button>
          </div>
        </div>
      </main>
    );
  }

  if (!roomId) {
    return (
      <main className="app-shell centered">
        <div className="panel panel-elevated lobby-panel">
          <h1 className="app-title">Room Lobby</h1>
          <p className="player-id">Player: <strong>{playerName}</strong></p>
          <div className="form-grid room-form">
            <input
              className="input code"
              value={roomInput}
              onChange={e => setRoomInput(e.target.value.toUpperCase())}
              placeholder="ROOM CODE"
              maxLength={8}
              style={{ textTransform: 'uppercase' }}
            />
            <button className="btn secondary" onClick={handleJoinRoom} disabled={!roomInput.trim()}>Join</button>
            <button className="btn primary" onClick={handleCreateRoom} disabled={creatingRoom}>{creatingRoom ? 'Creating...' : 'Create Room'}</button>
          </div>
          {errorMsg && <p className="error inline-error">{errorMsg}</p>}
          <p className="hint">Room codes are 5 random characters when created.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell game-shell">
      {isWinner && <Confetti />}
      <header className="game-header">
        <h1 className="room-title">Bingo Room <span className="room-code">{roomId}</span></h1>
        <div className="meta-line">
          <span className="badge player">{playerName}</span>
          <span className={`badge conn ${status}`}>{status}</span>
          <span className={`badge phase phase-${phase}`}>{phase}</span>
          <span className="badge turn">Turn: {currentPlayer || '-'}</span>
        </div>
      </header>
      <section className="side-panel players-panel">
        <h2 className="subheading">Players</h2>
        <ul className="player-list">
          {players.map(p => (
            <li key={p} className={p === currentPlayer ? 'current' : ''}>
              <span>{p}</span>
              {p === currentPlayer && <span className="turn-indicator" aria-label="Current turn">▶</span>}
            </li>
          ))}
        </ul>
        {winner && <div className="winner-banner">🏆 {winner} wins!</div>}
        {lastInvalid && Date.now() - lastInvalid.at < 4000 && (
          <div className="inline-warning">⚠ {lastInvalid.reason}</div>
        )}
      </section>
      <section className='board-wrapper'>
        <div className='bingo-card modern-grid'>
          {cardElements}
        </div>
      </section>
      <footer className="controls-bar">
        <button className="btn ghost" onClick={handleReset} disabled={status !== 'connected'}>{winner ? 'New Game' : 'Reset'}</button>
        <button className="btn danger" onClick={() => { sessionStorage.removeItem('roomId'); setRoomId(''); setRoomInput(''); }}>Leave Room</button>
      </footer>
    </main>
  );
}
