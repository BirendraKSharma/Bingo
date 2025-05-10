from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

app = FastAPI()
clients = {}

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


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    clients[websocket] = "Unknown"

    try:
        while True:
            data = await websocket.receive_json()

            if data["type"] == "join":
                clients[websocket] = data["name"]
                print(f"{data['name']} joined the game.")

            elif data["type"] == "mark_number":
                # Use a list of active clients to prevent sending to closed connections
                active_clients = []
                for client in clients:
                    try:
                        await client.send_json({
                            "type": "mark_number",
                            "number": data["number"],
                            "marked_by": clients[websocket]
                        })
                        active_clients.append(client)
                    except RuntimeError:
                        # This client connection is closed
                        print(f"Removed closed client connection: {clients.get(client, 'Unknown')}")
                        pass
                
                # Update clients dictionary to only include active connections
                clients = {client: clients[client] for client in active_clients}

            elif data["type"] == "winner":
                winner = clients[websocket]
                print(f"{winner} has won the game!")
                
                # Again, handle closed connections
                active_clients = []
                for client in list(clients.keys()):
                    try:
                        await client.send_json({
                            "type": "winner",
                            "winner": winner
                        })
                        active_clients.append(client)
                    except RuntimeError:
                        # This client connection is closed
                        pass
                
                # Update clients dictionary to only include active connections
                clients = {client: clients[client] for client in active_clients}

            elif data["type"] == "reset":
                active_clients = []
                for client in list(clients.keys()):
                    try:
                        await client.send_json({ "type": "reset" })
                        active_clients.append(client)
                    except RuntimeError:
                        # This client connection is closed
                        pass
                
                # Update clients dictionary to only include active connections
                clients = {client: clients[client] for client in active_clients}

    except WebSocketDisconnect:
        # Client disconnected
        name = clients.pop(websocket, "Unknown")
        print(f"{name} disconnected.")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
