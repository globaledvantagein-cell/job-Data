// emailManager.js
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { SES_CONFIG } from "../env.js";

const sesClient = new SESClient({
    region: SES_CONFIG.region,
    credentials: SES_CONFIG.credentials,
});

/**
 * Formats a list of jobs into HTML for a personalized email.
 */
function formatJobsToHtml(user, jobs) {
    let jobsHtml = "";
    for (const job of jobs) {
        jobsHtml += `
            <table cellpadding="0" cellspacing="0" border="0" style="width:100%; margin-bottom:16px; background:#ffffff; border:1px solid #e5e7eb; border-radius:4px;">
                <tr>
                    <td style="padding:16px;">
                        <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                            <tr>
                                <td style="vertical-align:middle;">
                                    <h3 style="color:#111827; margin:0 0 6px 0; font-size:18px; font-weight:700; font-family: Georgia, 'Times New Roman', Times, serif;">${job.JobTitle}</h3>
                                    <p style="color:#6b7280; margin:0; font-size:13px; font-family: Georgia, 'Times New Roman', Times, serif;">
                                        <strong>${job.sourceSite}</strong> • ${job.Location}
                                    </p>
                                </td>
                                <td style="text-align:right; vertical-align:middle; width:120px;">
                                    <a href="${job.ApplicationURL}" target="_blank" style="display:inline-block; color:#111827; background:#ffffff; border:1px solid #111827; padding:8px 12px; text-decoration:none; border-radius:4px; font-size:13px; font-weight:500; font-family: Georgia, 'Times New Roman', Times, serif;">
                                        View &amp; Apply
                                    </a>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>`;
    }

    return `
        <!DOCTYPE html>
        <html>
            <head>
                <title>Your Weekly Job Digest</title>
                <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            </head>
            <body style="margin:0; padding:0; background:#f6f6f4; -webkit-font-smoothing:antialiased;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%; background:#f6f6f4; padding:24px 0;">
                    <tr>
                        <td align="center">
                            <table cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:640px; background-color:#faf9f6; background-image: url('https://www.toptal.com/designers/subtlepatterns/uploads/paper-fibers.png'); border:1px solid #e5e7eb; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
                                <tr>
                                    <td style="padding:20px 24px; border-bottom:1px solid #e5e7eb;">
                                        <h1 style="color:#111827; margin:0; font-size:20px; font-weight:700; font-family: Georgia, 'Times New Roman', Times, serif;">Hi ${user.name}, Weekly Job Digest</h1>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:20px 24px;">${jobsHtml}</td>
                                </tr>
                                <tr>
                                    <td style="padding:16px 24px; border-top:1px solid #e5e7eb;">
                                        <p style="color:#6b7280; margin:0; font-size:12px; font-family: Georgia, 'Times New Roman', Times, serif;">To unsubscribe, please visit your profile.</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </body>
        </html>`;
}

/**
 * Sends a personalized email with matching jobs to a single user.
 */
export async function sendEmailNotification(user, jobs) {
    if (!user || !jobs || jobs.length === 0) {
        console.log(`No new jobs to send to ${user.name}.`);
        return false;
    }

    const subject = `✨ ${jobs.length} New Job Matches Just For You!`;
    const htmlContent = formatJobsToHtml(user, jobs);

    const params = {
        Source: SES_CONFIG.fromEmail,
        Destination: {
            ToAddresses: [user.email],
        },
        Message: {
            Subject: {
                Data: subject,
                Charset: 'UTF-8',
            },
            Body: {
                Html: {
                    Data: htmlContent,
                    Charset: 'UTF-8',
                },
            },
        },
    };

    try {
        const command = new SendEmailCommand(params);
        const result = await sesClient.send(command);
        console.log(`✅ Email sent successfully to ${user.email}! Message ID: ${result.MessageId}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to send email to ${user.email}: ${error}`);
        return false;
    }
}
