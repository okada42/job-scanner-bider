FROM python:3.12-slim

WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt
COPY backend /app/backend
COPY supabase /app/supabase
COPY .env.example /app/.env.example

ENV PYTHONPATH=/app/backend
ENV PORT=8000
EXPOSE 8000
CMD ["python", "/app/backend/run.py"]
