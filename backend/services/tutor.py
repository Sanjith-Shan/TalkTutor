import asyncio
import json
import os
from openai import AsyncOpenAI
from fastapi import WebSocket

client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

async def handle_tutor_session(websocket: WebSocket):

    await websocket.accept()
    print("Client connected to tutor session")
    
    try:
        async with client.beta.realtime.connect(
            model="gpt-4o-realtime-preview-2024-12-17"
        ) as openai_ws:
            
            await openai_ws.send({
                "type": "session.update",
                "session": {
                    "modalities": ["text", "audio"],
                    "instructions": (
                        "You are a patient AI tutor. "
                        "Your job is to help the student learn by asking probing questions, "
                        "encouraging critical thinking, and breaking problems into steps. "
                        "Never just give the final answer immediately. "
                        "Instead, guide the student with hints and open-ended questions. "
                        "For now, the problem the student will be working on is the algebra problem: 5x + 4 = 24."
                        "Start by greeting the student and then bring up the problem at hand."
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
            })
            
            # Forward audio from browser to gpt
            async def browser_to_openai():
                try:
                    while True:
                        data = await websocket.receive_text()
                        message = json.loads(data)
                        
                        if message["type"] == "audio":
                            # Send audio to gpt
                            await openai_ws.send({
                                "type": "input_audio_buffer.append",
                                "audio": message["audio"]
                            })
                        elif message["type"] == "stop":
                            print("Client requested stop")
                            break
                            
                except Exception as e:
                    print(f"Error receiving from browser: {e}")
            
            # Forward responses from gpt to browser
            async def openai_to_browser():
                try:
                    async for event in openai_ws:
                        if event.type == "response.audio.delta":
                            await websocket.send_json({
                                "type": "audio",
                                "audio": event.delta
                            })
                        
                        # Send gpt transcript
                        elif event.type == "response.audio_transcript.delta":
                            await websocket.send_json({
                                "type": "ai_transcript",
                                "text": event.delta
                            })
                        
                        # Send user transcript
                        elif event.type == "conversation.item.input_audio_transcription.completed":
                            await websocket.send_json({
                                "type": "user_transcript",
                                "text": event.transcript
                            })
                        
                        # Speech detection 
                        elif event.type == "input_audio_buffer.speech_started":
                            await websocket.send_json({
                                "type": "speech_started"
                            })
                        
                        elif event.type == "input_audio_buffer.speech_stopped":
                            await websocket.send_json({
                                "type": "speech_stopped"
                            })
                        
                        elif event.type == "error":
                            await websocket.send_json({
                                "type": "error",
                                "error": event.error
                            })
                            print(f"OpenAI error: {event.error}")
                            
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