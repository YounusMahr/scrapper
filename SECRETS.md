# GitHub Secrets Setup

Go to: **Your Repo → Settings → Secrets and variables → Actions → New repository secret**

## Required Secrets

| Secret Name | Value | Where to Find |
|-------------|-------|---------------|
| `EC2_HOST` | `34.201.x.x` | AWS Console → EC2 → Your instance → Public IPv4 |
| `EC2_USERNAME` | `ubuntu` | Default for Ubuntu AMIs |
| `EC2_SSH_KEY` | `-----BEGIN RSA PRIVATE KEY-----...` | Content of your `.pem` key file |
| `MONGODB_URI` | `mongodb+srv://user:pass@cluster...` | Your MongoDB Atlas connection string |

## How to Get EC2 SSH Key

```bash
# On your local machine
cat ~/Downloads/your-key.pem
```

Copy the entire output including the BEGIN and END lines.

## How to Add Secrets

1. Go to your GitHub repo
2. Click **Settings** tab
3. Click **Secrets and variables** → **Actions**
4. Click **New repository secret**
5. Enter the **Name** and **Value** from the table above
6. Click **Add secret**

Repeat for each secret.
