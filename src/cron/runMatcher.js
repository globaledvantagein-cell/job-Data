import { getSubscribedUsers, findMatchingJobs, updateUserAfterEmail } from '../db/index.js';
import { sendEmailNotification } from '../utils/emailManager.js';
import { ObjectId } from 'mongodb';

let isMatching = false;

export async function runMatcher() {
    if (isMatching) {
        console.log('Matcher is already running. Skipping this scheduled run.');
        return;
    }
    isMatching = true;
    console.log("🏃‍♂️ Starting the job matcher and email sender task...");

    try {
        const users = await getSubscribedUsers();
        if (users.length === 0) {
            console.log("No subscribed users found.");
            isMatching = false; // Make sure to reset flag
            return;
        }
        console.log(`[Matcher] Found ${users.length} users to process.`);

        for (const user of users) {
            console.log(`\n[Matcher] 🔎 Finding matches for ${user.name} (${user.email})...`);
            const matchingJobs = await findMatchingJobs(user);

            if (matchingJobs.length === 0) {
                console.log(`[Matcher] No new matching jobs found for ${user.name}.`);
                continue;
            }

            const emailSent = await sendEmailNotification(user, matchingJobs);

            if (emailSent) {
                const sentJobIds = matchingJobs.map(job => job.JobID);
                await updateUserAfterEmail(new ObjectId(user._id), sentJobIds);
                console.log(`[Matcher] Updated database for ${user.name}.`);
            }
        }
        console.log("\n✅ All users processed. Matcher finished.");
    } catch (error) {
        console.error("An error occurred during the matching task:", error);
    } finally {
        isMatching = false;
        console.log("Matcher task finished.");
    }
}
