'use client'

import { Suspense, useMemo, useState } from 'react'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import MainLayout from '@/components/layout/MainLayout'
import { Tabs } from '@/components/ui/tabs'
import TextEmailTemplatesTab from './components/TextEmailTemplatesTab'
import TextEmailCreatorTab from './components/TextEmailCreatorTab'
import GlobalLoader from '@/components/shared/GlobalLoader'

function TextEmailPageInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const rawView = searchParams.get('view') || 'templates'
  const activeTab = rawView === 'creator' ? 'creator' : 'templates'
  const [creatorInitial, setCreatorInitial] = useState(null)
  const [dataVersion, setDataVersion] = useState(0)

  const setActiveTab = (tab) => {
    const params = new URLSearchParams(searchParams?.toString() || '')
    params.set('view', tab)
    router.push(`${pathname}?${params.toString()}`)
  }

  const tabValue = useMemo(() => activeTab, [activeTab])

  return (
    <MainLayout
      title="Text Email"
      subtitle="Create plain-text email templates and manage org / global scope"
    >
      <div className="h-full min-h-full flex flex-col">
        <Tabs value={tabValue} onValueChange={setActiveTab} className="w-full h-full min-h-full flex flex-col">
          <TextEmailTemplatesTab
            dataVersion={dataVersion}
            onDataChanged={() => setDataVersion((v) => v + 1)}
            onCreateNew={() => {
              setCreatorInitial(null)
              setActiveTab('creator')
            }}
            onEdit={(tpl) => {
              setCreatorInitial(tpl)
              setActiveTab('creator')
            }}
          />
          <TextEmailCreatorTab
            initialTemplate={creatorInitial}
            dataVersion={dataVersion}
            onBack={() => {
              setCreatorInitial(null)
              setActiveTab('templates')
            }}
            onCreated={() => {
              setCreatorInitial(null)
              setDataVersion((v) => v + 1)
              setActiveTab('templates')
            }}
          />
        </Tabs>
      </div>
    </MainLayout>
  )
}

export default function TextEmailPage() {
  return (
    <Suspense
      fallback={
        <MainLayout
          title="Text Email"
          subtitle="Create plain-text email templates and manage org / global scope"
        >
          <div className="flex items-center justify-center py-20">
            <GlobalLoader variant="inline" size="md" />
          </div>
        </MainLayout>
      }
    >
      <TextEmailPageInner />
    </Suspense>
  )
}
