FROM python:3.12-slim

# Force unbuffered stdout/stderr so Python log output flushes immediately —
# otherwise Docker / Fly log capture can lag minutes behind reality.
ENV PYTHONUNBUFFERED=1

WORKDIR /app
COPY pyproject.toml loader.py ./
RUN pip install --no-cache-dir .

EXPOSE 8080
CMD ["python", "loader.py"]
