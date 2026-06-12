FROM python:3.12-slim

RUN apt update && apt install -y socat

WORKDIR /app
COPY challenge.py .

CMD socat TCP-L:1337,fork,reuseaddr EXEC:"python3 challenge.py"
