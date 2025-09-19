from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import random
import string
import uuid
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
#       "winner": str | None,
#       "round": int,
#       "player_ids": { websocket: player_id },
#       "id_to_name": { player_id: player_name }
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
        "players": {},            # websocket -> player_name
        "player_names": {},       # player_name -> websocket
        "numbers_drawn": set(),
        "winner": None,
        "round": 1,
        "player_ids": {},         # websocket -> player_id
        "id_to_name": {}          # player_id -> player_name
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
        "winner": room["winner"],
        "round": room["round"]
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
    # provisional placeholder player_id until join
    room["player_ids"][websocket] = str(uuid.uuid4())

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "join":
                player_name = data.get("name", "Unknown")
                existing_player_id = data.get("player_id")
                # If client supplies a player_id and we can map it, attempt to reuse name
                if existing_player_id and existing_player_id in room.get("id_to_name", {}):
                    # Re-associate websocket with existing identity
                    mapped_name = room["id_to_name"][existing_player_id]
                    room["players"][websocket] = mapped_name
                    room["player_names"][mapped_name] = websocket
                    room["player_ids"][websocket] = existing_player_id
                else:
                    # fresh player id
                    player_id = str(uuid.uuid4())
                    room["players"][websocket] = player_name
                    room["player_names"][player_name] = websocket
                    room["player_ids"][websocket] = player_id
                    room["id_to_name"][player_id] = player_name
                # final player_id
                player_id_final = room["player_ids"][websocket]
                # Send current state to the new player (authoritative snapshot)
                await websocket.send_json({
                    "type": "state",
                    "numbers_drawn": list(room["numbers_drawn"]),
                    "winner": room["winner"],
                    "players": list(room["player_names"].keys()),
                    "round": room["round"],
                    "player_id": player_id_final
                })
                # Notify others of new player (exclude self)
                for client in list(room["players"].keys()):
                    if client is websocket:
                        continue
                    try:
                        await client.send_json({
                            "type": "player_joined",
                            "player": room["players"][websocket],
                            "players": list(room["player_names"].keys())
                        })
                    except Exception as e:
                        print(f"Error notifying player join: {e}")

            elif msg_type == "mark_number":
                number = data.get("number")
                if number is None:
                    continue
                room["numbers_drawn"].add(number)
                # broadcast inside room
                for client in list(room["players"].keys()):
                    try:
                        await client.send_json({
                            "type": "mark_number",
                            "number": number,
                            "marked_by": room["players"][websocket]
                        })
                    except Exception as e:
                        print(f"Error sending mark_number: {e}")

            elif msg_type == "winner":
                if not room["winner"]:
                    room["winner"] = room["players"].get(websocket, "Unknown")
                for client in list(room["players"].keys()):
                    try:
                        await client.send_json({
                            "type": "winner",
                            "winner": room["winner"]
                        })
                    except Exception as e:
                        print(f"Error sending winner: {e}")

            elif msg_type == "reset":
                room["numbers_drawn"].clear()
                room["winner"] = None
                room["round"] += 1
                for client in list(room["players"].keys()):
                    try:
                        await client.send_json({
                            "type": "reset",
                            "round": room["round"]
                        })
                    except Exception as e:
                        print(f"Error sending reset: {e}")

            elif msg_type == "heartbeat":
                await websocket.send_json({"type": "heartbeat_ack"})

    except WebSocketDisconnect:
        player_name = room["players"].pop(websocket, "Unknown")
        if player_name in room["player_names"]:
            del room["player_names"][player_name]
        # remove player id mapping
        pid = room["player_ids"].pop(websocket, None)
        if pid and pid in room["id_to_name"] and room["id_to_name"][pid] == player_name:
            # keep id_to_name to allow reconnection? choose policy: retain mapping for some time.
            # For now we retain mapping so player can reconnect with same player_id.
            pass
        # notify remaining players
        for client in list(room["players"].keys()):
            try:
                await client.send_json({
                    "type": "player_left",
                    "player": player_name,
                    "players": list(room["player_names"].keys())
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
        pid = room["player_ids"].pop(websocket, None)
        if pid and pid in room["id_to_name"] and room["id_to_name"][pid] == player_name:
            pass
        if not room["players"]:
            del rooms[room_id]
            print(f"Room {room_id} deleted (empty after error)")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
