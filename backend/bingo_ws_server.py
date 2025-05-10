from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

app = FastAPI()
# Make sure clients is properly defined as a global variable
clients = {}  # Dictionary to store active client connections

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
    # Make sure to use the global clients dictionary
    global clients
    clients[websocket] = "Unknown"
    
    try:
        while True:
            data = await websocket.receive_json()

            if data["type"] == "join":
                clients[websocket] = data["name"]
                print(f"{data['name']} joined the game.")

            elif data["type"] == "mark_number":
                # Copy the clients dictionary to avoid changing it during iteration
                active_clients = list(clients.keys())
                for client in active_clients:
                    try:
                        if client.client_state.CONNECTED:  # Check if the client is still connected
                            await client.send_json({
                                "type": "mark_number",
                                "number": data["number"],
                                "marked_by": clients[websocket]
                            })
                    except Exception as e:
                        print(f"Error sending to client: {e}")
                        # Don't modify clients here, just log the error

            elif data["type"] == "winner":
                winner = clients[websocket]
                print(f"{winner} has won the game!")
                
                active_clients = list(clients.keys())
                for client in active_clients:
                    try:
                        await client.send_json({
                            "type": "winner",
                            "winner": winner
                        })
                    except Exception as e:
                        print(f"Error sending winner notification: {e}")

            elif data["type"] == "reset":
                active_clients = list(clients.keys())
                for client in active_clients:
                    try:
                        await client.send_json({ "type": "reset" })
                    except Exception as e:
                        print(f"Error sending reset: {e}")

    except WebSocketDisconnect:
        # Client disconnected
        player_name = clients.pop(websocket, "Unknown")
        print(f"{player_name} disconnected.")
    except Exception as e:
        print(f"Error in WebSocket connection: {e}")
        if websocket in clients:
            player_name = clients.pop(websocket, "Unknown")
            print(f"{player_name} disconnected due to error.")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
