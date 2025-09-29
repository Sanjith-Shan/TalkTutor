import asyncio
import json
import os
import ssl
import certifi
import websockets
from fastapi import WebSocket
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("OPENAI_API_KEY")

async def handle_tutor_session(websocket: WebSocket):
    await websocket.accept()
    print("Client connected to tutor session")
    
    try:
        url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17"
        headers = {
            "Authorization": f"Bearer {API_KEY}",
            "OpenAI-Beta": "realtime=v1"
        }
        
        ssl_context = ssl.create_default_context(cafile=certifi.where())
        
        async with websockets.connect(url, additional_headers=headers, ssl=ssl_context) as openai_ws:
            await openai_ws.send(json.dumps({
                "type": "session.update",
                "session": {
                    "modalities": ["text", "audio"],
                    "instructions": (
                        "You are a patient AI tutor. "
                        "Your job is to help the student learn by asking probing questions, "
                        "encouraging critical thinking, and breaking problems into steps. "
                        "Never just give the final answer immediately. "
                        "Instead, guide the student with hints and open-ended questions. "
                        "Start by greeting the student warmly and asking what they'd like to learn about. "
                        "If they're unsure, suggest the algebra problem: 5x + 4 = 24."
                    ),
                    "voice": "alloy",
                    "input_audio_format": "pcm16",
                    "output_audio_format": "pcm16",
                    "input_audio_transcription": {
                        "model": "whisper-1"
                    },
                    "turn_detection": {
                        "type": "server_vad",
                        "threshold": 0.5,
                        "prefix_padding_ms": 300,
                        "silence_duration_ms": 700
                    }
                }
            }))
            
            async def browser_to_openai():
                try:
                    while True:
                        data = await websocket.receive_text()
                        message = json.loads(data)
                        
                        if message["type"] == "audio":
                            await openai_ws.send(json.dumps({
                                "type": "input_audio_buffer.append",
                                "audio": message["audio"]
                            }))
                        elif message["type"] == "stop":
                            print("Client requested stop")
                            break
                except Exception as e:
                    print(f"Error receiving from browser: {e}")
            
            async def openai_to_browser():
                try:
                    async for message in openai_ws:
                        event = json.loads(message)
                        
                        if event.get("type") == "response.audio.delta":
                            await websocket.send_json({
                                "type": "audio",
                                "audio": event.get("delta")
                            })
                        
                        elif event.get("type") == "response.audio_transcript.delta":
                            await websocket.send_json({
                                "type": "ai_transcript",
                                "text": event.get("delta")
                            })
                        
                        elif event.get("type") == "conversation.item.input_audio_transcription.completed":
                            await websocket.send_json({
                                "type": "user_transcript",
                                "text": event.get("transcript")
                            })
                        
                        elif event.get("type") == "input_audio_buffer.speech_started":
                            await websocket.send_json({
                                "type": "speech_started"
                            })
                        
                        elif event.get("type") == "input_audio_buffer.speech_stopped":
                            await websocket.send_json({
                                "type": "speech_stopped"
                            })
                        
                        elif event.get("type") == "error":
                            await websocket.send_json({
                                "type": "error",
                                "error": event.get("error")
                            })
                            print(f"OpenAI error: {event.get('error')}")
                            
                except Exception as e:
                    print(f"Error sending to browser: {e}")
            
            await asyncio.gather(
                browser_to_openai(),
                openai_to_browser()
            )
            
    except Exception as e:
        print(f"WebSocket error: {e}")
        await websocket.send_json({
            "type": "error",
            "error": str(e)
        })
    
    finally:
        await websocket.close()
        print("Tutor session ended")