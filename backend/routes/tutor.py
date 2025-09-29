from fastapi import APIRouter, WebSocket
from backend.services.tutor import handle_tutor_session

router = APIRouter()

@router.websocket("/ws/tutor")
async def tutor_websocket_endpoint(websocket: WebSocket):
    await handle_tutor_session(websocket)