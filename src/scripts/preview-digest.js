/**
 * Preview the digest template with rich mock data.
 *
 * This script sends a digest using fake job data so you can see how the
 * template looks with multiple jobs, salary ranges, remote tags, etc.,
 * WITHOUT touching your actual users or jobs collection.
 *
 * Usage:
 *   node src/scripts/preview-digest.js your-email@gmail.com
 *
 * The recipient must be verified in SES Identities (sandbox restriction).
 */
import { renderWeeklyDigest, sendEmail } from '../email/index.js';
import { client as mongoClient } from '../db/connection.js';

const email = process.argv[2];
if (!email) {
    console.error('Usage: node src/scripts/preview-digest.js your-email@gmail.com');
    process.exit(1);
}

const mockUser = {
    email,
    name: 'Ashish Ranjan',
    desiredCategories: ['software', 'data', 'product_tech', 'other_tech'],
};

// Mix of jobs across categories with varying data shapes —
// some have salary, some don't, some are remote, some are full-time, etc.
const mockJobsByCategory = {
    software: [
        {
            JobID: 'mock-1',
            JobTitle: 'Senior Backend Engineer (Python/Go)',
            Company: 'Stripe',
            Location: 'Berlin, Germany',
            EmploymentType: 'FullTime',
            WorkplaceType: 'Hybrid',
            IsRemote: false,
            SalaryMin: 90000,
            SalaryMax: 130000,
            SalaryCurrency: 'EUR',
            SalaryInterval: 'yearly',
            PostedDate: new Date(Date.now() - 2 * 86400000),
        },
        {
            JobID: 'mock-2',
            JobTitle: 'Staff Software Engineer, Platform',
            Company: 'Wolt',
            Location: 'Frankfurt, Germany',
            EmploymentType: 'FullTime',
            IsRemote: true,
            SalaryMin: 105000,
            SalaryMax: 145000,
            SalaryCurrency: 'EUR',
            SalaryInterval: 'yearly',
            PostedDate: new Date(Date.now() - 4 * 86400000),
        },
        {
            JobID: 'mock-3',
            JobTitle: 'Frontend Engineer',
            Company: 'Raisin',
            Location: 'Berlin, Germany',
            EmploymentType: 'FullTime',
            WorkplaceType: 'Remote',
            // No salary on purpose
            PostedDate: new Date(Date.now() - 1 * 86400000),
        },
    ],
    data: [
        {
            JobID: 'mock-4',
            JobTitle: 'Senior Data Scientist, Machine Learning',
            Company: 'N26',
            Location: 'Berlin, Germany',
            EmploymentType: 'FullTime',
            SalaryMin: 85000,
            SalaryCurrency: 'EUR',
            SalaryInterval: 'yearly',
            PostedDate: new Date(Date.now() - 3 * 86400000),
        },
        {
            JobID: 'mock-5',
            JobTitle: 'Analytics Engineer',
            Company: 'Personio',
            Location: 'Munich, Germany',
            EmploymentType: 'FullTime',
            WorkplaceType: 'Hybrid',
            PostedDate: new Date(Date.now() - 5 * 86400000),
        },
    ],
    product_tech: [
        {
            JobID: 'mock-6',
            JobTitle: 'Senior Product Manager, Payments',
            Company: 'Klarna',
            Location: 'Berlin, Germany',
            EmploymentType: 'FullTime',
            IsRemote: false,
            SalaryMin: 95000,
            SalaryMax: 125000,
            SalaryCurrency: 'EUR',
            SalaryInterval: 'yearly',
            PostedDate: new Date(Date.now() - 6 * 86400000),
        },
    ],
    other_tech: [
        {
            JobID: 'mock-7',
            JobTitle: 'Site Reliability Engineer',
            Company: 'HelloFresh',
            Location: 'Berlin, Germany',
            EmploymentType: 'FullTime',
            WorkplaceType: 'Remote',
            PostedDate: new Date(Date.now() - 7 * 86400000),
        },
        {
            JobID: 'mock-8',
            JobTitle: 'Security Engineer',
            Company: 'Delivery Hero',
            Location: 'Berlin, Germany',
            EmploymentType: 'Contract',
            SalaryMax: 110000,
            SalaryCurrency: 'EUR',
            SalaryInterval: 'yearly',
            PostedDate: new Date(Date.now() - 2 * 86400000),
        },
    ],
};

const totalJobs = Object.values(mockJobsByCategory).reduce((sum, arr) => sum + arr.length, 0);

async function run() {
    console.log(`Rendering preview digest with ${totalJobs} mock jobs...`);
    const { subject, html, text } = renderWeeklyDigest({
        user: mockUser,
        jobsByCategory: mockJobsByCategory,
        totalJobs,
    });

    console.log(`Subject: ${subject}`);
    console.log(`Sending to: ${email}\n`);

    const result = await sendEmail({ to: email, subject, html, text });
    if (result.ok) {
        console.log('Sent successfully. MessageId:', result.messageId);
    } else {
        console.error('Failed:', result.error);
        process.exit(1);
    }
}

run()
    .then(() => mongoClient.close())
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Fatal:', err);
        mongoClient.close().finally(() => process.exit(1));
    });
