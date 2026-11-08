# One container: builds the React app, serves it + the API from FastAPI.
FROM node:22-slim AS web
WORKDIR /src
COPY frontend/package*.json frontend/
RUN cd frontend && npm ci
COPY frontend frontend
RUN mkdir -p backend && cd frontend && npm run build

FROM python:3.12-slim
WORKDIR /app/backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .
COPY --from=web /src/backend/static ./static
RUN python -c "from app.transit import Network; Network.load()"
ENV PORT=8000
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
