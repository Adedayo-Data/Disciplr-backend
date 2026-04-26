# Validation Error Contract

Endpoints that reject request payloads after schema validation return HTTP `400` with this envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request payload",
    "fields": [
      {
        "path": "email",
        "message": "Invalid email address",
        "code": "invalid_format"
      }
    ]
  }
}
```

Rules:

- `error.code` is always `VALIDATION_ERROR` for request validation failures.
- `error.message` is always `Invalid request payload`.
- `error.fields` is a flat array of client-friendly field issues.
- `path` uses dot notation for nested objects and bracket notation for arrays, for example `payload.subject` or `milestones[0].dueDate`.
- Root-level validation failures use `path: "root"`.
- `message` comes from the schema and should explain the problem without echoing secrets or entire payloads.
- `code` comes from the underlying validator issue code, such as `invalid_type`, `invalid_union`, `invalid_value`, `too_small`, or `custom`.

Examples:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request payload",
    "fields": [
      {
        "path": "amount",
        "message": "must be a positive number",
        "code": "custom"
      }
    ]
  }
}
```

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request payload",
    "fields": [
      {
        "path": "payload.subject",
        "message": "Invalid input: expected string, received undefined",
        "code": "invalid_type"
      }
    ]
  }
}
```
