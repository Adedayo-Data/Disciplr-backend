# API Query Patterns

This document outlines the standard patterns for querying the Disciplr API, including filtering, sorting, and pagination.

## Safe Querying

The API uses a hardened query parser to prevent SQL injection, prototype pollution, and unauthorized field access.

### Filtering

Filters are passed via the `filter` query parameter. Only allowlisted fields can be used for filtering.

**Basic equality:**
`GET /api/vaults?filter[status]=active`

**Using operators:**
`GET /api/vaults?filter[amount][gt]=1000&filter[amount][lt]=5000`

Supported operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `in`, `nin`.

### Sorting

Sorting is handled via the `sort` parameter.

**Single field:**
`GET /api/vaults?sort=created_at:desc`

**Multiple fields:**
`GET /api/vaults?sort=status:asc&sort=created_at:desc`

### Pagination

The API supports both page-based and cursor-based pagination.

**Page-based:**
`GET /api/vaults?page=2&pageSize=20`

**Cursor-based:**
`GET /api/vaults?limit=10&cursor=YTIwMjQtMDEtMDFUMDA6MDA6MDAuMDAwWnx2YXVsdF8xMjM=`

## Security Protections

1. **Prototype Pollution:** Dangerous keys such as `__proto__`, `constructor`, and `prototype` are automatically stripped from all query parameters.
2. **Explicit Allowlist:** Only fields explicitly allowed in the controller/service configuration can be used for filtering or sorting.
3. **Nested Access Prevention:** Arbitrary nested object path traversal (e.g., `filter[user.password_hash]=...`) is blocked unless the specific path is in the allowlist.
4. **Type Safety:** Filter values are sanitized and validated to ensure they match expected types (strings, numbers, or arrays of primitives).
