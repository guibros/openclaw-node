---
name: google-drive
description: "Google Drive API integration with managed OAuth via Maton gateway. List, search, create, download, share, and manage files and folders. Use when users want to interact with Google Drive."
compatibility: Requires network access and valid Maton API key
triggers:
  - "google drive"
  - "upload to drive"
  - "list drive files"
  - "download from google drive"
  - "share a google doc"
negative_triggers:
  - "local filesystem"
  - "dropbox"
  - "icloud"
  - "google sheets formulas"
metadata:
  author: maton
  version: "1.0"
---

# Google Drive

Access the Google Drive API with managed OAuth authentication. List, search, create, and manage files and folders.

## Quick Start

```bash
# List files
curl -s -X GET 'https://gateway.maton.ai/google-drive/drive/v3/files?pageSize=10' \
  -H 'Authorization: Bearer YOUR_API_KEY'
```

## Base URL

```
https://gateway.maton.ai/google-drive/{native-api-path}
```

Replace `{native-api-path}` with the actual Google Drive API endpoint path. The gateway proxies requests to `www.googleapis.com` and automatically injects your OAuth token.

## Authentication

All requests require the Maton API key in the Authorization header:

```
Authorization: Bearer YOUR_API_KEY
```

**Environment Variable:** Set your API key as `MATON_API_KEY`:

```bash
export MATON_API_KEY="YOUR_API_KEY"
```

### Getting Your API Key

1. Sign in or create an account at [maton.ai](https://maton.ai)
2. Go to [maton.ai/settings](https://maton.ai/settings)
3. Copy your API key

## Connection Management

Manage your Google OAuth connections at `https://ctrl.maton.ai`.

### List Connections

```bash
curl -s -X GET 'https://ctrl.maton.ai/connections?app=google-drive&status=ACTIVE' \
  -H 'Authorization: Bearer YOUR_API_KEY'
```

### Create Connection

```bash
curl -s -X POST 'https://ctrl.maton.ai/connections' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -d '{"app": "google-drive"}'
```

### Get Connection

```bash
curl -s -X GET 'https://ctrl.maton.ai/connections/{connection_id}' \
  -H 'Authorization: Bearer YOUR_API_KEY'
```

**Response:**
```json
{
  "connection": {
    "connection_id": "21fd90f9-5935-43cd-b6c8-bde9d915ca80",
    "status": "ACTIVE",
    "creation_time": "2025-12-08T07:20:53.488460Z",
    "last_updated_time": "2026-01-31T20:03:32.593153Z",
    "url": "https://connect.maton.ai/?session_token=...",
    "app": "google-drive",
    "metadata": {}
  }
}
```

Open the returned `url` in a browser to complete OAuth authorization.

### Delete Connection

```bash
curl -s -X DELETE 'https://ctrl.maton.ai/connections/{connection_id}' \
  -H 'Authorization: Bearer YOUR_API_KEY'
```

### Specifying Connection

If you have multiple Google Drive connections, specify which one to use with the `Maton-Connection` header:

```bash
curl -s -X GET 'https://gateway.maton.ai/google-drive/drive/v3/files?pageSize=10' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Maton-Connection: 21fd90f9-5935-43cd-b6c8-bde9d915ca80'
```

If omitted, the gateway uses the default (oldest) active connection.

## API Reference

### List Files

```bash
GET /google-drive/drive/v3/files?pageSize=10
```

With query:

```bash
GET /google-drive/drive/v3/files?q=name%20contains%20'report'&pageSize=10
```

Only folders:

```bash
GET /google-drive/drive/v3/files?q=mimeType='application/vnd.google-apps.folder'
```

Files in specific folder:

```bash
GET /google-drive/drive/v3/files?q='FOLDER_ID'+in+parents
```

With fields:

```bash
GET /google-drive/drive/v3/files?fields=files(id,name,mimeType,createdTime,modifiedTime,size)
```

### Get File Metadata

```bash
GET /google-drive/drive/v3/files/{fileId}?fields=id,name,mimeType,size,createdTime
```

### Download File Content

```bash
GET /google-drive/drive/v3/files/{fileId}?alt=media
```

### Export Google Docs

```bash
GET /google-drive/drive/v3/files/{fileId}/export?mimeType=application/pdf
```

### Create File (metadata only)

```bash
POST /google-drive/drive/v3/files
Content-Type: application/json

{
  "name": "New Document",
  "mimeType": "application/vnd.google-apps.document"
}
```

### Create Folder

```bash
POST /google-drive/drive/v3/files
Content-Type: application/json

{
  "name": "New Folder",
  "mimeType": "application/vnd.google-apps.folder"
}
```

### Update File Metadata

```bash
PATCH /google-drive/drive/v3/files/{fileId}
Content-Type: application/json

{
  "name": "Renamed File"
}
```

### Move File to Folder

```bash
PATCH /google-drive/drive/v3/files/{fileId}?addParents=NEW_FOLDER_ID&removeParents=OLD_FOLDER_ID
```

### Delete File

```bash
DELETE /google-drive/drive/v3/files/{fileId}
```

### Copy File

```bash
POST /google-drive/drive/v3/files/{fileId}/copy
Content-Type: application/json

{
  "name": "Copy of File"
}
```

### Share File

```bash
POST /google-drive/drive/v3/files/{fileId}/permissions
Content-Type: application/json

{
  "role": "reader",
  "type": "user",
  "emailAddress": "user@example.com"
}
```

## Query Operators

Use in the `q` parameter:
- `name = 'exact name'`
- `name contains 'partial'`
- `mimeType = 'application/pdf'`
- `'folderId' in parents`
- `trashed = false`
- `modifiedTime > '2024-01-01T00:00:00'`

Combine with `and`:
```
name contains 'report' and mimeType = 'application/pdf'
```

## Common MIME Types

- `application/vnd.google-apps.document` - Google Docs
- `application/vnd.google-apps.spreadsheet` - Google Sheets
- `application/vnd.google-apps.presentation` - Google Slides
- `application/vnd.google-apps.folder` - Folder
- `application/pdf` - PDF

## Code Examples

### JavaScript

```javascript
const response = await fetch(
  'https://gateway.maton.ai/google-drive/drive/v3/files?pageSize=10',
  {
    headers: {
      'Authorization': `Bearer ${process.env.MATON_API_KEY}`
    }
  }
);
```

### Python

```python
import os
import requests

response = requests.get(
    'https://gateway.maton.ai/google-drive/drive/v3/files',
    headers={'Authorization': f'Bearer {os.environ["MATON_API_KEY"]}'},
    params={'pageSize': 10}
)
```

## Notes

- Use `fields` parameter to limit response data
- Pagination uses `pageToken` from previous response's `nextPageToken`
- Export is for Google Workspace files only

## Error Handling

| Status | Meaning |
|--------|---------|
| 400 | Missing Google Drive connection |
| 401 | Invalid or missing Maton API key |
| 429 | Rate limited (10 req/sec per account) |
| 4xx/5xx | Passthrough error from Google Drive API |

## Resources

- [Drive API Overview](https://developers.google.com/drive/api/reference/rest/v3)
- [List Files](https://developers.google.com/drive/api/reference/rest/v3/files/list)
- [Get File](https://developers.google.com/drive/api/reference/rest/v3/files/get)
- [Create File](https://developers.google.com/drive/api/reference/rest/v3/files/create)
- [Update File](https://developers.google.com/drive/api/reference/rest/v3/files/update)
- [Delete File](https://developers.google.com/drive/api/reference/rest/v3/files/delete)
- [Export File](https://developers.google.com/drive/api/reference/rest/v3/files/export)
- [Search Query Syntax](https://developers.google.com/drive/api/guides/search-files)
