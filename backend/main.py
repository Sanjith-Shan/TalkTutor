from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.routers.tutor_router import router as tutor_router

app = FastAPI(title="ConvoLearn API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tutor_router)

@app.get("/")
def read_root():
    return {
        "status": "ConvoLearn API is running",
        "endpoints": {
            "websocket": "/ws/tutor"
        }
    }

