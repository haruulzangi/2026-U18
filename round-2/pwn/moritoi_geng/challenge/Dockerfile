FROM python:3.11-alpine

RUN adduser -D -u 1000 app

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py ./
COPY static ./static

RUN chown -R app:app /app

USER app

ENV HTTP_PORT=8080 WS_PORT=4448 PYTHONUNBUFFERED=1

EXPOSE 8080 4448

CMD ["python", "-u", "server.py"]
