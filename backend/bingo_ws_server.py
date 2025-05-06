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
                for client in clients:
                    await client.send_json({
                        "type": "mark_number",
                        "number": data["number"],
                        "marked_by": clients[websocket]
                    })

            elif data["type"] == "winner":
                winner = clients[websocket]
                print(f"{winner} has won the game!")
                for client in clients:
                    await client.send_json({
                        "type": "winner",
                        "winner": winner
                    })

            elif data["type"] == "reset":
                for client in clients:
                    await client.send_json({ "type": "reset" })

    except WebSocketDisconnect:
        clients.pop(websocket, None)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
