import fetch from 'node-fetch';

async function test() {
    const res1 = await fetch('https://jobs.workable.com/api/v1/jobs?location=Germany&limit=100');
    const data1 = await res1.json();
    console.log(`Page 1 Jobs: ${data1.jobs ? data1.jobs.length : 0}`);
    console.log(`PageToken: ${data1.nextPageToken}`);
    
    if (data1.nextPageToken) {
        let res2 = await fetch(`https://jobs.workable.com/api/v1/jobs?location=Germany&limit=100&pageToken=${data1.nextPageToken}`);
        let data2 = await res2.json();
        console.log(`Page 2 Jobs (pageToken): ${data2.jobs ? data2.jobs.length : 0}`);
        
        let res3 = await fetch(`https://jobs.workable.com/api/v1/jobs?location=Germany&limit=100&token=${data1.nextPageToken}`);
        let data3 = await res3.json();
        console.log(`Page 2 Jobs (token): ${data3.jobs ? data3.jobs.length : 0}`);
        
        console.log(`Page 1 First Job: ${data1.jobs[0]?.id}`);
        console.log(`Page 2 (pageToken) First Job: ${data2.jobs && data2.jobs.length > 0 ? data2.jobs[0].id : 'N/A'}`);
        console.log(`Page 2 (token) First Job: ${data3.jobs && data3.jobs.length > 0 ? data3.jobs[0].id : 'N/A'}`);
    }
}
test().catch(console.error);
