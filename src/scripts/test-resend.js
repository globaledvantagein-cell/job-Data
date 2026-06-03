/**
 * Quick Resend test — send one email to verify the setup works.
 *
 * Usage: node src/scripts/test-resend.js
 */
import 'dotenv/config';
import { sendEmail } from '../email/index.js';

const TEST_TO = 'ashar050488@gmail.com';

const result = await sendEmail({
    to: TEST_TO,
    subject: '✅ Resend Test — English Jobs Germany',
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #2563eb;">It works!</h2>
            <p>This is a test email from <strong>English Jobs Germany</strong> sent via Resend.</p>
            <p>If you're reading this, the email setup is working correctly.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
            <p style="color: #6b7280; font-size: 14px;">
                From: noreply@englishjobsgermany.com<br/>
                Reply-To: support@englishjobsgermany.com
            </p>
        </div>
    `,
    text: 'This is a test email from English Jobs Germany sent via Resend. If you are reading this, the email setup is working correctly.',
});

if (result.ok) {
    console.log(`✅ Email sent successfully! Message ID: ${result.messageId}`);
} else {
    console.error(`❌ Failed to send: ${result.error}`);
}