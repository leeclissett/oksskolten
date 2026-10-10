# Using the Google Reader API

Oksskolten exposes a Google Reader–compatible endpoint at `/reader/api/0/`. This lets native feed reader apps like **NetNewsWire**, **Reeder**, and others sync feeds, articles, read/unread state, and starred items directly with your Oksskolten instance.

## Setup

No additional configuration is required. Use your existing Oksskolten account credentials (email and password) to authenticate.

### Connect your feed reader

In your feed reader, choose **FreshRSS** or **Google Reader** as the account type and use the following settings:

| Field | Value |
|---|---|
| **Server URL** | `https://your-oksskolten.example.com` |
| **Username** | Your Oksskolten email address |
| **Password** | Your Oksskolten account password |

## NetNewsWire

1. Open NetNewsWire → **Add Feed Account**
2. Choose **FreshRSS**
3. Enter your server URL, email, and password
4. NetNewsWire will authenticate and download your feeds

## Supported operations

| Feature | Supported |
|---|---|
| List subscriptions | ✅ |
| List folders/tags | ✅ |
| Unread articles | ✅ |
| Starred articles | ✅ |
| Mark as read/unread | ✅ |
| Star/unstar articles | ✅ |
| Article content | ✅ |

## Authentication

The Google Reader API uses a token-based auth flow:

1. Client POSTs credentials to `/accounts/ClientLogin`
2. Server returns a JWT token in the response body as `Auth=<token>`
3. Subsequent requests include `Authorization: GoogleLogin auth=<token>`

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/accounts/ClientLogin` | Authenticate and get token |
| `GET` | `/reader/api/0/user-info` | Get user info |
| `GET` | `/reader/api/0/tag/list` | List folders/tags |
| `GET` | `/reader/api/0/subscription/list` | List subscriptions |
| `GET` | `/reader/api/0/unread-count` | Get unread counts by feed and folder |
| `GET` | `/reader/api/0/stream/items/ids` | Get article IDs for a stream |
| `POST` | `/reader/api/0/stream/items/contents` | Get article content by IDs |
| `GET` | `/reader/api/0/stream/contents?s=<stream>` | Get article content for a query-selected stream |
| `GET` | `/reader/api/0/stream/contents/<stream>` | Get article content for a stream |
| `POST` | `/reader/api/0/edit-tag` | Mark articles read/unread/starred |
| `POST` | `/reader/api/0/mark-all-as-read` | Mark all articles in a stream as read |

Streams (`stream/items/ids` and `stream/contents`) list articles by the time they arrived in Oksskolten, newest first, as FreshRSS does. `ot` and `nt` bound that arrival time, `r=o` reverses the order, and `c` continues from the previous page. Ordering by arrival is what lets a reader app find a newly added feed: its backlog arrives now, however old the posts are.

In `unread-count`, `newestItemTimestampUsec` is the time a feed's newest article arrived in Oksskolten, not its publication date. This matches FreshRSS, and lets clients that skip unchanged feeds notice a newly added feed whose latest post is older than their last sync.

Each item's `canonical` and `alternate` link is the article's page on the web. Inline feed entries such as email newsletters have no page at their own URL, so the link is the original post when Oksskolten found one, and otherwise the article's page on this server (built from the host the client connected to).

An explicit `com.google/read` edit records the article as actually read in Oksskolten (`read_at` and `seen_at`). Removing that state clears both timestamps. Bulk mark-all operations only set `seen_at`, because they represent clearing a stream rather than opening every article.
