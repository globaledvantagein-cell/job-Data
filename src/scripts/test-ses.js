/**
 * Quick SES test — sends a single email to verify the setup works.
 *
 * Usage:  node src/scripts/test-ses.js your-email@gmail.com
 *
 * In sandbox mode, the recipient email MUST be verified in SES Identities.
 */
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import dotenv from 'dotenv';

dotenv.config();

const REGION = process.env.SES_REGION || 'eu-central-1';
const FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@englishjobsgermany.com';
const FROM_NAME = process.env.SES_FROM_NAME || 'English Jobs Germany';
const TO_EMAIL = process.argv[2];

if (!TO_EMAIL) {
    console.error('Usage: node src/scripts/test-ses.js your-email@gmail.com');
    process.exit(1);
}

if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set in .env');
    process.exit(1);
}

const sesClient = new SESv2Client({
    region: REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

async function sendTestEmail() {
    console.log(`Sending test email...`);
    console.log(`  From: ${FROM_NAME} <${FROM_EMAIL}>`);
    console.log(`  To:   ${TO_EMAIL}`);
    console.log(`  Region: ${REGION}\n`);

    const unsubscribeUrl = 'https://englishjobsgermany.com/alerts';

    const htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; max-width: 580px; margin: 0 auto; padding: 20px 0;">

    <p style="font-size: 14px; color: #555; margin: 0 0 20px;">English Jobs in Germany — Weekly Digest</p>

    <p style="font-size: 15px; line-height: 1.6; margin: 0 0 20px;">Hi there, here are this week's new English-speaking roles in Germany that match your preferences:</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 12px; border-collapse: collapse;">
        <tr>
            <td style="padding: 14px 16px; border: 1px solid #e2e2e2; border-radius: 6px;">
                <a href="https://englishjobsgermany.com/jobs" style="font-size: 15px; font-weight: 600; color: #1a1a1a; text-decoration: none;">Senior Backend Engineer</a>
                <div style="font-size: 13px; color: #666; margin-top: 4px;">Stripe — Berlin, Germany</div>
                <div style="font-size: 12px; color: #888; margin-top: 4px;">Software Engineering · Full-time · Posted 2 days ago</div>
            </td>
        </tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 12px; border-collapse: collapse;">
        <tr>
            <td style="padding: 14px 16px; border: 1px solid #e2e2e2; border-radius: 6px;">
                <a href="https://englishjobsgermany.com/jobs" style="font-size: 15px; font-weight: 600; color: #1a1a1a; text-decoration: none;">Data Analyst</a>
                <div style="font-size: 13px; color: #666; margin-top: 4px;">Raisin — Berlin, Germany</div>
                <div style="font-size: 12px; color: #888; margin-top: 4px;">Data / AI · Full-time · Posted 3 days ago</div>
            </td>
        </tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px; border-collapse: collapse;">
        <tr>
            <td style="padding: 14px 16px; border: 1px solid #e2e2e2; border-radius: 6px;">
                <a href="https://englishjobsgermany.com/jobs" style="font-size: 15px; font-weight: 600; color: #1a1a1a; text-decoration: none;">Product Manager, Growth</a>
                <div style="font-size: 13px; color: #666; margin-top: 4px;">Wolt — Frankfurt, Germany</div>
                <div style="font-size: 12px; color: #888; margin-top: 4px;">Product (Tech) · Full-time · Posted 5 days ago</div>
            </td>
        </tr>
    </table>

    <p style="font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
        <a href="https://englishjobsgermany.com/jobs" style="color: #1a73e8; text-decoration: none;">View all open positions</a>
    </p>

    <div style="border-top: 1px solid #e2e2e2; padding-top: 16px; font-size: 12px; color: #999; line-height: 1.6;">
        <p style="margin: 0 0 6px;">You are receiving this because you subscribed to weekly job alerts on English Jobs in Germany.</p>
        <p style="margin: 0 0 6px;">Need help? Reply to this email or reach us at support@englishjobsgermany.com</p>
        <p style="margin: 0;"><a href="${unsubscribeUrl}" style="color: #999; text-decoration: underline;">Unsubscribe</a></p>
    </div>

</div>`;

    const textBody = `English Jobs in Germany — Weekly Digest

Hi there, here are this week's new English-speaking roles in Germany that match your preferences:

1. Senior Backend Engineer
   Stripe — Berlin, Germany
   Software Engineering · Full-time · Posted 2 days ago

2. Data Analyst
   Raisin — Berlin, Germany
   Data / AI · Full-time · Posted 3 days ago

3. Product Manager, Growth
   Wolt — Frankfurt, Germany
   Product (Tech) · Full-time · Posted 5 days ago

View all open positions: https://englishjobsgermany.com/jobs

---
You are receiving this because you subscribed to weekly job alerts on English Jobs in Germany.
Need help? Contact support@englishjobsgermany.com
Unsubscribe: ${unsubscribeUrl}`;

    const command = new SendEmailCommand({
        FromEmailAddress: `${FROM_NAME} <${FROM_EMAIL}>`,
        ReplyToAddresses: ['support@englishjobsgermany.com'],
        Destination: {
            ToAddresses: [TO_EMAIL],
        },
        ListManagementOptions: undefined,
        Content: {
            Simple: {
                Subject: {
                    Data: 'Your weekly job digest — 3 new roles in Germany',
                    Charset: 'UTF-8',
                },
                Body: {
                    Html: { Data: htmlBody, Charset: 'UTF-8' },
                    Text: { Data: textBody, Charset: 'UTF-8' },
                },
                Headers: [
                    { Name: 'List-Unsubscribe', Value: `<${unsubscribeUrl}>` },
                    { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
                ],
            },
        },
    });

    try {
        const response = await sesClient.send(command);
        console.log('Email sent successfully!');
        console.log(`Message ID: ${response.MessageId}`);
        console.log(`\nCheck your inbox at ${TO_EMAIL}`);
    } catch (error) {
        console.error(`Failed: ${error.message}`);
        if (error.message.includes('not verified')) {
            console.error(`Hint: In sandbox mode, recipient must be verified in SES Identities.`);
        }
        process.exit(1);
    }
}

sendTestEmail();