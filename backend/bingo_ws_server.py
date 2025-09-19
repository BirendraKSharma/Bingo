from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import random
import string
from typing import Dict, List, Any

app = FastAPI()

# -------------------------------
# In-memory room management
# -------------------------------
# rooms structure:
# rooms = {
#   room_id: {
#       "players": { websocket: player_name, ... },
#       "player_names": { player_name: websocket },  # reverse lookup convenience
#       "numbers_drawn": set[int],
#       "winner": str | None
#   }
# }
rooms: Dict[str, Dict[str, Any]] = {}

def generate_room_code(length: int = 5) -> str:
    # Simple human friendly uppercase letters + digits (avoid 0/O confusion by excluding 0)
    alphabet = string.ascii_uppercase + "123456789"
    while True:
        code = ''.join(random.choice(alphabet) for _ in range(length))
        if code not in rooms:
            return code

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def health_check():
    return {"status": "OK", "message": "Bingo WebSocket server is running"}

@app.post("/rooms")
async def create_room():
    room_id = generate_room_code()
    rooms[room_id] = {
        "players": {},
        "player_names": {},
        "numbers_drawn": set(),
        "winner": None,
        # Turn-based additions
        "turn_order": [],        # list[str]
        "turn_index": 0,         # int pointer into turn_order
        "phase": "waiting"       # waiting | active | finished
    }
    return {"room_id": room_id}

@app.get("/state/{room_id}")
async def get_room_state(room_id: str):
    room = rooms.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return {
        "room_id": room_id,
        "players": list(room["player_names"].keys()),
        "numbers_drawn": list(room["numbers_drawn"]),
        "winner": room["winner"]
    }

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    # Validate room exists
    if room_id not in rooms:
        await websocket.close(code=4404)
        return
    await websocket.accept()

    room = rooms[room_id]
    room["players"][websocket] = "Unknown"

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "join":
                player_name = data.get("name", "Unknown")
                # Prevent duplicate names in same room
                if player_name in room["player_names"]:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Name already taken in this room"
                    })
                    continue
                room["players"][websocket] = player_name
                room["player_names"][player_name] = websocket
                # Add to turn order if game not started
                if room["phase"] == "waiting":
                    room["turn_order"].append(player_name)
                # Derive current player name
                current_player = None
                if room["turn_order"]:
                    # If phase waiting and this is first player, keep waiting until at least 2? For now allow start with 1
                    current_player = room["turn_order"][room["turn_index"]]
                # Send current state including turn info to new player
                await websocket.send_json({
                    "type": "state",
                    "numbers_drawn": list(room["numbers_drawn"]),
                    "winner": room["winner"],
                    "players": list(room["player_names"].keys()),
                    "turn_order": room["turn_order"],
                    "current_player": current_player,
                    "phase": room["phase"]
                })
                # Notify others
                for client in list(room["players"].keys()):
                    if client is websocket:
                        continue
                    try:
                        await client.send_json({
                            "type": "player_joined",
                            "player": player_name,
                            "players": list(room["player_names"].keys()),
                            "turn_order": room["turn_order"],
                            "current_player": current_player,
                            "phase": room["phase"]
                        })
                    except Exception as e:
                        print(f"Error notifying player join: {e}")

            elif msg_type == "mark_number":
                if room["winner"]:
                    continue  # ignore moves after game finished
                number = data.get("number")
                if number is None:
                    continue
                player_name = room["players"].get(websocket)
                if not player_name:
                    continue
                # Auto-start game on first valid mark
                if room["phase"] == "waiting":
                    room["phase"] = "active"
                # Enforce turn
                if room["turn_order"]:
                    expected = room["turn_order"][room["turn_index"]]
                    if player_name != expected:
                        # Send invalid move to this player only
                        try:
                            await websocket.send_json({
                                "type": "invalid_move",
                                "reason": "Not your turn",
                                "current_player": expected
                            })
                        except Exception as e:
                            print(f"Error sending invalid_move: {e}")
                        continue
                # Reject duplicate number
                if number in room["numbers_drawn"]:
                    try:
                        await websocket.send_json({
                            "type": "invalid_move",
                            "reason": "Number already drawn",
                            "current_player": room["turn_order"][room["turn_index"]] if room["turn_order"] else None
                        })
                    except Exception:
                        pass
                    continue
                room["numbers_drawn"].add(number)
                # Broadcast mark
                for client in list(room["players"].keys()):
                    try:
                        await client.send_json({
                            "type": "mark_number",
                            "number": number,
                            "marked_by": player_name
                        })
                    except Exception as e:
                        print(f"Error sending mark_number: {e}")
                # Advance turn if turn order exists
                if room["turn_order"] and room["phase"] == "active" and not room["winner"]:
                    room["turn_index"] = (room["turn_index"] + 1) % len(room["turn_order"])
                    next_player = room["turn_order"][room["turn_index"]]
                    for client in list(room["players"].keys()):
                        try:
                            await client.send_json({
                                "type": "next_turn",
                                "current_player": next_player,
                                "turn_order": room["turn_order"]
                            })
                        except Exception as e:
                            print(f"Error sending next_turn: {e}")

            elif msg_type == "winner":
                if not room["winner"]:
                    room["winner"] = room["players"].get(websocket, "Unknown")
                    room["phase"] = "finished"
                for client in list(room["players"].keys()):
                    try:
                        await client.send_json({
                            "type": "winner",
                            "winner": room["winner"],
                            "phase": room["phase"]
                        })
                    except Exception as e:
                        print(f"Error sending winner: {e}")

            elif msg_type == "reset":
                room["numbers_drawn"].clear()
                room["winner"] = None
                room["turn_index"] = 0
                room["phase"] = "waiting"
                for client in list(room["players"].keys()):
                    try:
                        await client.send_json({
                            "type": "reset",
                            "turn_order": room["turn_order"],
                            "current_player": room["turn_order"][0] if room["turn_order"] else None,
                            "phase": room["phase"]
                        })
                    except Exception as e:
                        print(f"Error sending reset: {e}")

            elif msg_type == "heartbeat":
                await websocket.send_json({"type": "heartbeat_ack"})

    except WebSocketDisconnect:
        player_name = room["players"].pop(websocket, "Unknown")
        if player_name in room["player_names"]:
            del room["player_names"][player_name]
        # notify remaining players
        # Remove from turn order
        if player_name in room.get("turn_order", []):
            idx = room["turn_order"].index(player_name)
            room["turn_order"].remove(player_name)
            # Adjust turn_index if needed
            if room["turn_index"] >= len(room["turn_order"]):
                room["turn_index"] = 0
            # If the leaving player was the current player and game active, advance turn
            if room["phase"] == "active" and room["turn_order"]:
                current_player = room["turn_order"][room["turn_index"]]
            else:
                current_player = room["turn_order"][room["turn_index"]] if room["turn_order"] else None
        else:
            current_player = room["turn_order"][room["turn_index"]] if room["turn_order"] else None

        for client in list(room["players"].keys()):
            try:
                await client.send_json({
                    "type": "player_left",
                    "player": player_name,
                    "players": list(room["player_names"].keys()),
                    "turn_order": room.get("turn_order", []),
                    "current_player": current_player,
                    "phase": room.get("phase")
                })
            except Exception as e:
                print(f"Error notifying player leave: {e}")
        # If room empty, delete
        if not room["players"]:
            del rooms[room_id]
            print(f"Room {room_id} deleted (empty)")
        print(f"{player_name} disconnected from room {room_id}")
    except Exception as e:
        print(f"Unexpected error in WebSocket room {room_id}: {e}")
        player_name = room["players"].pop(websocket, "Unknown")
        if player_name in room["player_names"]:
            del room["player_names"][player_name]
        if not room["players"]:
            del rooms[room_id]
            print(f"Room {room_id} deleted (empty after error)")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
