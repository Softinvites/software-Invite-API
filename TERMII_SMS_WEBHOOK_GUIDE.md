# Termii SMS Webhook Integration Guide

## Overview

This document provides complete instructions for setting up and testing the Termii SMS webhook integration with SoftInvites.

## Prerequisites

- Termii account with API credentials
- Webhook URL accessible from the internet (or ngrok tunnel for local development)
- Event ID with SMS configured in the system

## Setup Instructions

### 1. Environment Variables

Ensure these environment variables are configured:

```bash
TERMII_API_KEY=<your-termii-api-key>
TERMII_BASE_URL=https://api.ng.termii.com
TERMII_SMS_URL=https://api.ng.termii.com/api/sms/send
TERMII_SENDER_ID=SoftInvites          # Your Termii Sender ID
TERMII_CHANNEL=generic                 # Channel type (generic, dnd, etc.)
SMS_PROVIDER=termii                    # Optional: forces Termii provider
```

### 2. Configure Webhook in Termii Dashboard

1. Log in to [Termii Dashboard](https://dashboard.termii.com)
2. Navigate to **Settings** → **Webhooks** or **API Settings**
3. Add a new webhook endpoint:
   - **Webhook URL**: `https://your-api-domain.com/webhook/termii/sms`
   - **Event Types**: Select "SMS Status Updates" or similar
   - **Method**: POST
   - **Active**: Enable

Example webhook URLs:
- **Production**: `https://api.softinvites.com/webhook/termii/sms`
- **Staging**: `https://staging-api.softinvites.com/webhook/termii/sms`
- **Local Dev**: `https://your-ngrok-tunnel.ngrok.io/webhook/termii/sms`

### 3. Testing Webhook Connectivity

Before sending SMS, verify the webhook endpoint is reachable:

```bash
# Test GET endpoint (diagnostic)
curl -X GET https://your-api-domain.com/webhook/termii/sms

# Expected Response:
# {
#   "ok": true,
#   "message": "Termii SMS webhook is reachable..."
# }
```

## Webhook Payload Format

Termii sends status updates with the following payload structure:

```json
{
  "message_id": "1709123456-abc123",
  "status": "delivered",
  "phone_number": "+2348012345678",
  "timestamp": "2025-01-15T10:30:45Z",
  "cost": 1.5,
  "error_message": null
}
```

### Supported Status Values

| Status | Normalized | Description |
|--------|-----------|-------------|
| `sent` | `sent` | Message delivered to network |
| `delivered` | `delivered` | Message delivered to recipient |
| `failed` | `failed` | General delivery failure |
| `failed_invalid_phone` | `failed` | Invalid phone number |
| `failed_no_network` | `failed` | No network available |
| `failed_phone_offline` | `failed` | Recipient phone offline |
| `bounced` | `failed` | Message bounced |
| `pending` | `queued` | Still in queue |

### Field Mappings

The webhook handler normalizes Termii field names:

- `message_id` or `messageId` → Stored in database as `providerMessageId`
- `status` → Normalized and stored
- `timestamp` → Parsed and stored in corresponding date field
- `error_message` → Stored if status is `failed`
- `cost` → Optional, stored in `cost` field

## SMS Message Status Flow

```
┌─────────┐
│ queued  │  Initial state when SMS is created
└────┬────┘
     │ (SMS sent to Termii)
     ▼
┌─────────┐
│  sent   │  Webhook received with status: sent
└────┬────┘
     │ (Message in transit)
     ├────────────────────────────┐
     ▼                            ▼
┌──────────┐                 ┌─────────┐
│ delivered│  Success        │ failed  │  Failed delivery
└──────────┘                 └─────────┘
```

## Database Schema

SMS messages are stored in the `smsmessages` collection:

```typescript
{
  _id: ObjectId,
  eventId: ObjectId,          // Reference to event
  rsvpId: ObjectId | null,    // Reference to RSVP (if applicable)
  to: string,                 // Recipient phone number
  status: "queued" | "sent" | "delivered" | "failed",
  providerMessageId: string,  // Message ID from Termii
  provider: "termii",
  cost: number,               // SMS cost in credits
  errorMessage: string | null,// Error details if failed
  sentAt: Date | null,        // When Termii confirmed sent
  deliveredAt: Date | null,   // When recipient received it
  failedAt: Date | null,      // When delivery failed
  createdAt: Date,            // When record was created
  updatedAt: Date             // Last update timestamp
}
```

## Testing the Webhook

### Option 1: Using cURL (Local Development with ngrok)

1. Start ngrok tunnel:
   ```bash
   ngrok http 3000
   # Note the forwarding URL
   ```

2. Update Termii webhook settings with ngrok URL

3. Send a test SMS:
   ```bash
   curl -X POST http://localhost:3000/api/sms/send \
     -H "Content-Type: application/json" \
     -d '{
       "eventId": "507f1f77bcf86cd799439011",
       "to": "+2348012345678",
       "message": "Test SMS from SoftInvites"
     }'
   ```

4. Simulate webhook callback:
   ```bash
   curl -X POST http://localhost:3000/webhook/termii/sms \
     -H "Content-Type: application/json" \
     -d '{
       "message_id": "test-msg-123",
       "status": "delivered",
       "phone_number": "+2348012345678",
       "timestamp": "2025-01-15T10:30:45Z",
       "cost": 1.5
     }'
   ```

### Option 2: Using Postman

1. Create a new POST request
2. Set URL: `http://localhost:3000/webhook/termii/sms`
3. Set body (JSON):
   ```json
   {
     "message_id": "test-msg-123",
     "status": "delivered",
     "phone_number": "+2348012345678",
     "timestamp": "2025-01-15T10:30:45Z",
     "cost": 1.5
   }
   ```
4. Send and verify response is `200 OK`

### Option 3: Using Termii API Test Panel

If Termii provides an API test panel:
1. Navigate to webhooks section
2. Select the webhook
3. Click "Send Test" or similar
4. Verify response in logs

## Webhook Response

The handler always returns:

```json
{
  "success": true,
  "message": "Status updated successfully",
  "messageId": "1709123456-abc123",
  "status": "delivered"
}
```

**Note**: The endpoint returns `200 OK` even if the message isn't found in the database, to prevent Termii from retrying indefinitely.

## Monitoring & Debugging

### View Webhook Logs

```bash
# Check API logs for webhook processing
tail -f logs/webhook-events.log

# Search for specific message ID
grep "1709123456-abc123" logs/webhook-events.log
```

### Query SMS Status in Database

```javascript
// MongoDB query
db.smsmessages.findOne({ 
  providerMessageId: "1709123456-abc123" 
})

// Expected output:
{
  _id: ObjectId("..."),
  eventId: ObjectId("..."),
  to: "+2348012345678",
  status: "delivered",
  providerMessageId: "1709123456-abc123",
  provider: "termii",
  cost: 1.5,
  deliveredAt: ISODate("2025-01-15T10:30:45.000Z"),
  sentAt: ISODate("2025-01-15T10:30:40.000Z"),
  createdAt: ISODate("2025-01-15T10:30:35.000Z"),
  updatedAt: ISODate("2025-01-15T10:30:45.000Z")
}
```

### Common Issues & Solutions

#### 1. Webhook Not Being Called

**Symptoms**: SMS sent but status never updates

**Solution**:
- Verify webhook URL is publicly accessible: `curl https://your-api.com/webhook/termii/sms`
- Check Termii dashboard webhook settings
- Verify API key in Termii account
- Check API logs for incoming requests

#### 2. "Missing message_id in payload"

**Symptoms**: Webhook returns 400 error

**Solution**:
- Ensure Termii is sending `message_id` or `messageId` field
- Contact Termii support if field name differs
- Check Termii API documentation for your account region

#### 3. "Unknown status received"

**Symptoms**: Status not updating, warning logged

**Solution**:
- Termii may send status value not in normalization map
- Add the new status to `normalizeTermiiStatus()` function
- Contact support with status value received

#### 4. Message not found warning

**Symptoms**: Log says "SMS message not found with providerMessageId"

**Solution**:
- Verify SMS was actually sent (check `smsmessages` collection)
- Check if `providerMessageId` was stored correctly when SMS was sent
- Ensure database is accessible from webhook handler

## Analytics Endpoint

Query SMS delivery statistics:

```bash
curl -X GET https://your-api.com/events/[eventId]/analytics/sms \
  -H "Authorization: Bearer [token]"

# Response:
{
  "sent": 150,
  "delivered": 142,
  "failed": 8,
  "pending": 0,
  "deliveryRate": 94.67
}
```

## Rate Limiting

- SMS service limits 3 SMS per RSVP per 24 hours
- Ensure Termii account tier supports your volume
- Monitor costs via `cost` field in SMS messages

## References

- [Termii API Documentation](https://developers.termii.com/)
- [Termii SMS Send API](https://developers.termii.com/docs/messaging)
- [Termii Webhook Documentation](https://developers.termii.com/docs/webhook)

## Support

For issues with:
- **SoftInvites implementation**: Review logs in `src/controllers/termiiWebhookController.ts`
- **Termii service**: Contact Termii support or check their documentation
- **Webhook routing**: Check `src/routes/webhookRoutes.ts`
