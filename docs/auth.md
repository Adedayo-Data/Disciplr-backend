# Authentication API

## Registration

Endpoint: `POST /api/auth/register`

### Request Body
```json
{
  "email": "user@example.com",
  "password": "securepassword123",
  "role": "USER"
}
```
- `role` is optional (defaults to `USER`). Options: `USER`, `VERIFIER`, `ADMIN`.

### Response (201 Created)
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "role": "USER"
}
```

### Errors
- `400 Bad Request`: Validation failure or missing fields.
- `409 Conflict`: Email already in use.
```json
{
  "error": "Email already in use"
}
```

## Security Assumptions
- Passwords are hashed using `bcryptjs` with a cost factor of 12.
- Email existence is not leaked during login (generic "Invalid credentials" error).
- Password hashes are never returned in registration or login responses.
