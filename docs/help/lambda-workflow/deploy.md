---
id: lw-deploy
tab: lambda
title: Deploying to LocalStack
icon: Rocket
---

Deploy from the **Deploy** button on a cached build card or from the Deployments page. Make sure LocalStack is running and connection settings are correct.

If the function already exists, the deploy updates it with new code - no need to delete and recreate. The deploy override modal lets you confirm or skip redeployment.

## Memory configuration

Java Lambdas on LocalStack need more memory due to cold start overhead. Default is **2048 MB**. Change per-function via the Memory dropdown. Bump up if you see `OutOfMemoryError`.
