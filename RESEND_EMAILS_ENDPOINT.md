# Resend All Emails Endpoint

## Overview
This endpoint allows you to resend invitation emails to all guests with email addresses for a specific event. It uses the same email template and format as the `addGuest` and `updateGuest` endpoints.

## Endpoint Details
- **URL**: `POST /guest/resend-all-emails/:eventId`
- **Method**: POST
- **Authentication**: Required (auth middleware)
- **Parameters**: 
  - `eventId` (URL parameter): The ID of the event

## How It Works
1. **Validation**: Checks if the event exists and has guests with email addresses
2. **Lambda Invocation**: Triggers the `resendEmailsLambda` function asynchronously
3. **Email Processing**: Lambda processes guests in batches of 10
4. **Email Content**: Uses the same professional template as individual guest emails
5. **Admin Notification**: Sends completion summary to `softinvites@gmail.com`

## Response Format

### Success (202 Accepted)
```json
{
  "message": "Email resend job started for 25 guests. Admin will receive notification when complete.",
  "eventName": "Annual Conference 2025",
  "guestsWithEmail": 25
}
```

### Error Responses

#### Event Not Found (404)
```json
{
  "message": "Event not found"
}
```

#### No Guests with Email (404)
```json
{
  "message": "No guests with email addresses found"
}
```

#### Server Error (500)
```json
{
  "message": "Error starting resend emails job",
  "error": "Detailed error message"
}
```

## Usage Example

### cURL
```bash
curl -X POST \
  https://your-api-domain.com/guest/resend-all-emails/64f8a1b2c3d4e5f6a7b8c9d0 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

### JavaScript/Fetch
```javascript
const response = await fetch('/guest/resend-all-emails/64f8a1b2c3d4e5f6a7b8c9d0', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});

const result = await response.json();
console.log(result);
```

## Lambda Function Details

### Environment Variables Required
- `RESEND_EMAILS_LAMBDA_FUNCTION_NAME`: Name of the resend emails Lambda function
- `EMAIL_LAMBDA_FUNCTION_NAME`: Name of the email sending Lambda function
- `PNG_CONVERT_LAMBDA`: Name of the PNG conversion Lambda function
- `ADMIN_EMAIL`: Admin email address for notifications

### Processing Flow
1. **Database Connection**: Connects to MongoDB
2. **Guest Retrieval**: Finds all guests with email addresses for the event
3. **Batch Processing**: Processes guests in batches of 10 to avoid overwhelming the email service
4. **QR Code Conversion**: Converts SVG QR codes to PNG format for email compatibility
5. **Email Sending**: Sends invitation emails using the professional template
6. **Admin Notification**: Sends completion summary to admin

### Email Template Features
- **Professional Design**: Uses the same beautiful template as individual invitations
- **QR Code Integration**: Includes PNG QR codes for email compatibility
- **Download Links**: Provides direct download links for QR codes
- **Event Branding**: Uses event colors and information
- **Mobile Responsive**: Optimized for all devices

## Admin Notification Email
After completion, the admin receives an email with:
- Event name
- Total number of guests processed
- Success count
- Failure count
- Completion timestamp

## Error Handling
- **Batch Processing**: Continues processing even if individual emails fail
- **PNG Conversion**: Falls back to SVG if PNG conversion fails
- **Lambda Retries**: Built-in retry mechanism for failed operations
- **Logging**: Comprehensive logging for debugging

## Performance Considerations
- **Asynchronous Processing**: Returns immediately while processing in background
- **Batch Processing**: Processes 10 guests at a time to avoid rate limits
- **Memory Efficient**: Streams data to avoid memory issues with large guest lists
- **Timeout Handling**: Designed to work within Lambda timeout limits

## Security
- **Authentication Required**: Only authenticated users can trigger resends
- **Event Validation**: Ensures the event exists before processing
- **Email Validation**: Only sends to guests with valid email addresses
- **Rate Limiting**: Batch processing prevents overwhelming email services