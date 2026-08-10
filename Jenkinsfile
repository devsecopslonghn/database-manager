@Library(['company-ci', 'company-cd']) _

ciPipeline(
    type: 'container',
    application: 'database-manager',
    language: 'javascript',
    buildSystem: 'npm',
    sourceDirectories: ['backend', 'frontend'],
    sonarSources: ['backend', 'frontend'],
    securityScans: [
        sonar: false,
        trivy: true,
        codeql: true,
        securityBlock: false,
        sonarProjectKey: 'database-manager'
    ],
    artifactProfile: 'nexus-container-dev',
    images: [
        [name: 'frontend', dockerfile: 'frontend/Dockerfile'],
        [name: 'backend', dockerfile: 'backend/Dockerfile']
    ]
)

cdPipeline(
    strategy: 'gitops',
    application: 'database-manager',
    deploymentProfile: 'database-manager-dev',
    valuesFile: 'database-manager/values.yaml',
    variables: [imageTag: env.IMAGE_TAG]
)
