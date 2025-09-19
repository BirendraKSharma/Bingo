# Multiplayer Bingo (Rooms + WebSockets)

Full‑stack Bingo game with:

Frontend: React + Vite (room lobby, real‑time updates)
Backend: FastAPI + WebSockets (per-room state, players, numbers, winners)

## Features

- Create or join a room via generated 5‑character code (e.g. `AB123`).
- Each room maintains its own player list, numbers drawn, and winner.
- Real‑time synchronization using WebSockets (`/ws/{room_id}`).
- REST endpoints for creating rooms and fetching current state (useful on reconnect):
	- `POST /rooms` → `{ "room_id": "ABCDE" }`
	- `GET /state/{room_id}` → current players, numbers drawn, winner.
- Automatic cleanup: empty rooms are deleted when last player disconnects.
- Client reconnection with exponential backoff and state re-sync.
- Per-tab persistence of player name and last room (via `sessionStorage`). Opening a new tab now prompts for a new identity.
- Deterministic per-player board generation using a seed derived from `room_id + player_id + round` (so reconnects preserve layout & progress alignment with drawn numbers).

## Backend (FastAPI) Overview

File: `backend/bingo_ws_server.py`

In‑memory structure:
```python
rooms = {
	room_id: {
		"players": { websocket: player_name },
		"player_names": { player_name: websocket },
		"numbers_drawn": set(),
		"winner": None | str
		"round": int,                # increments on each reset
		"player_ids": { websocket: player_id },
		"id_to_name": { player_id: player_name }
	}
}
```

WebSocket messages (per room):

| Type | Direction | Payload | Description |
|------|-----------|---------|-------------|
| `join` | client→server | `{ name, player_id? }` | Registers or re-associates player, returns state |
| `state` | server→client | `{ players, numbers_drawn, winner, round, player_id }` | Authoritative snapshot |
| `player_joined` | server→room | `{ player, players }` | New player broadcast |
| `player_left` | server→room | `{ player, players }` | Player left broadcast |
| `mark_number` | both | `{ number, marked_by }` | Number marked in room |
| `winner` | server→room | `{ winner }` | Winner announced (first only) |
| `reset` | server→room | `{ round }` | Clears numbers + winner, increments round |
| `heartbeat` / `heartbeat_ack` | optional | – | Keep-alive (not yet scheduled) |

> NOTE: State lives in memory; for production scale, migrate to a shared store (Redis) and add proper room lifecycle & authentication.

## Frontend Overview

Primary component: `frontend/src/RoomMultiplayerBingo.jsx`.

Environment variables (see `frontend/.env.example`):
```
VITE_API_URL=http://localhost:8000
VITE_WS_URL_BASE=ws://localhost:8000/ws
```
The runtime WebSocket URL becomes `${VITE_WS_URL_BASE}/${roomId}`.

## Local Development

### 1. Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn bingo_ws_server:app --reload --host 0.0.0.0 --port 8000
```

### 2. Frontend
```bash
cd frontend
cp .env.example .env   # adjust if needed
npm install
npm run dev
```

Open the printed Vite dev URL (usually `http://localhost:5173`).

### 3. Play
1. Enter a name.
2. Create a room (share the code) or join an existing one.
3. Click numbers to mark; first to 5 lines triggers a winner broadcast (client determines and informs server).
4. Reset to start a new game in the same room.

## Deployment

### Backend Deployment Options
1. **Docker** (recommended) – create a lightweight image exposing port 8000.
2. **Render / Railway / Fly.io** – run `uvicorn` process (`web` service).
3. **Azure / AWS / GCP** – container or managed app service (ensure WebSockets enabled).

Example minimal `Dockerfile`:
```Dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .
EXPOSE 8000
CMD ["uvicorn", "bingo_ws_server:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Frontend Deployment
1. Build: `npm run build` (outputs to `dist/`).
2. Host static bundle (Netlify, Vercel, GitHub Pages, S3+CloudFront, etc.).
3. Set environment variables for production build (e.g. `VITE_API_URL=https://your-backend` and `VITE_WS_URL_BASE=wss://your-backend/ws`).

> If deploying both behind the same domain, you can serve frontend via a CDN and backend separately; ensure CORS allows the frontend origin.

### Reverse Proxy (Nginx) Snippet
```nginx
location /ws/ {
	proxy_pass http://backend:8000/ws/;
	proxy_http_version 1.1;
	proxy_set_header Upgrade $http_upgrade;
	proxy_set_header Connection "upgrade";
	proxy_set_header Host $host;
}
location /state/ { proxy_pass http://backend:8000/state/; }
location /rooms { proxy_pass http://backend:8000/rooms; }
```

## Future Improvements (Suggestions)
- Persist rooms & numbers in Redis (TTL for idle rooms).
- Add authentication / tokens per player.
- Implement server-side win validation instead of trusting client.
- Add spectator mode and chat per room.
- Add rate limiting / flood protection.
- Salted seed or server-generated boards for anti-cheat (e.g. include secret per room).
- Store per-player boards server-side for authoritative validation.

## Troubleshooting
| Issue | Check |
|-------|-------|
| WebSocket fails | Correct `VITE_WS_URL_BASE`? Mixed http/https vs ws/wss? CORS? |
| State not syncing | Confirm `GET /state/{room}` returns 200; backend logs. |
| Winner not broadcasting | First winner only; ensure `winner` not already set. |
| Room not found | Expired (emptied) room – recreate. |

---
Enjoy playing Multiplayer Bingo!
