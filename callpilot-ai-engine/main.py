from fastapi import FastAPI

app = FastAPI(title="CallPilot AI Engine")


@app.get("/health")
async def health():
    return {"status": "healthy"}
