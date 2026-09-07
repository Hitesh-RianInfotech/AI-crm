'use client'

import MainLayout from '@/components/layout/MainLayout'
import WorkflowManagerClient from '@/components/workflow/WorkflowManagerClient'

export default function WorkflowsPage() {
  return (
    <MainLayout title="Workflows" subtitle="Create and manage workflows">
      <WorkflowManagerClient />
    </MainLayout>
  )
}
