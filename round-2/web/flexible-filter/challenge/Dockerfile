FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app

RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY . /app

RUN find . -name "__pycache__" -type d -exec rm -rf {} + || true

EXPOSE 3001

CMD ["sh", "-c", "python manage.py migrate && psql $DATABASE_URL -c \"SELECT COUNT(*) FROM blog_post\" | grep -q '0' && psql $DATABASE_URL -f /app/init.sql 2>/dev/null || true; python manage.py runserver 0.0.0.0:3001"]