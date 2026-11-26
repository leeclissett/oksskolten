import { useState, useEffect, useRef } from 'react'
import useSWR from 'swr'
import { useI18n } from '../../../lib/i18n'
import { fetcher, apiPatch } from '../../../lib/fetcher'
import { Input } from '@/components/ui/input'
import { FormField } from '@/components/ui/form-field'

export function ProfileSection() {
  const { t } = useI18n()
  const { data: profile, mutate: mutateProfile } = useSWR<{ account_name: string }>('/api/settings/profile', fetcher)
  const [editName, setEditName] = useState('')
  const [saving, setSaving] = useState(false)
  const initialized = useRef(false)

  useEffect(() => {
    if (profile && !initialized.current) {
      setEditName(profile.account_name)
      initialized.current = true
    }
  }, [profile])

  const isDirty = editName.trim() !== (profile?.account_name ?? '')

  function handleCancel() {
    setEditName(profile?.account_name ?? '')
  }

  async function handleSave() {
    const trimmed = editName.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      const newData = await apiPatch('/api/settings/profile', {
        account_name: trimmed,
      }) as { account_name: string }
      void mutateProfile(newData, { revalidate: false })
    } catch {
      // keep draft on failure
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <h2 className="text-base font-semibold text-text mb-4">{t('settings.profile')}</h2>
      <FormField label={t('settings.accountName')} hint={t('settings.accountNameHint')} compact>
        <Input
          type="text"
          value={editName}
          onChange={e => setEditName(e.target.value)}
          disabled={saving}
        />
      </FormField>
      {isDirty && (
        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={handleCancel}
            disabled={saving}
            className="px-3 py-1.5 text-sm rounded-lg border border-border text-text hover:bg-hover transition-colors"
          >
            {t('settings.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !editName.trim()}
            className="px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? t('settings.saving') : t('settings.save')}
          </button>
        </div>
      )}
    </section>
  )
}
