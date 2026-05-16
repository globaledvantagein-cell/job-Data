$ErrorActionPreference = "Stop"
$KEY = "$env:USERPROFILE\.ssh\EnglishJobsGermany.pem"
$EC2 = "ubuntu@3.75.90.49"

Write-Host "-> Pushing local changes to git..." -ForegroundColor Cyan
git add .
git commit -m "deploy"
git push

Write-Host "-> Pulling on server and restarting..." -ForegroundColor Cyan
ssh -i $KEY $EC2 "cd ~/job-Data && git pull && pm2 restart englishjobs-backend"

Write-Host "Deploy complete." -ForegroundColor Green