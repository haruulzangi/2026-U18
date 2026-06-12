FROM python:3.11-alpine

RUN adduser -D -u 1000 app

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py ./
COPY static ./static

RUN chown -R app:app /app

USER app

ENV PORT=8080

EXPOSE 8080

CMD ["python", "-u", "server.py"]
