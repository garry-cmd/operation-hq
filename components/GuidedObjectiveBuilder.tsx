'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem } from '@/lib/types'
import { ACTIVE_Q, COLORS } from '@/lib/utils'
import Modal from './Modal'

interface Props {
  objectives: AnnualObjective[]
  activeSpaceId: string
  onClose: () => void
  onSave: (objective: AnnualObjective, keyResults: Omit<RoadmapItem, 'id'>[]) => void
}

type Step = 'goal' | 'activities' | 'outcomes' | 'review'

interface ParsedKR {
  title: string
  isHabit: boolean
  habitType: 'daily' | 'weekly' | 'monthly' | 'outcome'
  suggestion?: string
}

export default function GuidedObjectiveBuilder({ objectives, activeSpaceId, onClose, onSave }: Props) {
  const [step, setStep] = useState<Step>('goal')
  const [objectiveName, setObjectiveName] = useState('')
  const [goalDescription, setGoalDescription] = useState('')
  const [activities, setActivities] = useState<string[]>([''])
  const [outcomes, setOutcomes] = useState<string[]>([''])
  const [parsedKRs, setParsedKRs] = useState<ParsedKR[]>([])
  const [selectedColor, setSelectedColor] = useState(COLORS[objectives.length % COLORS.length])
  const [isCreating, setIsCreating] = useState(false)

  // Smart pattern detection
  function analyzeKR(text: string): ParsedKR {
    const lower = text.toLowerCase().trim()
    
    // Daily patterns
    if (/(daily|every day|each day)/i.test(lower)) {
      return {
        title: text,
        isHabit: true,
        habitType: 'daily',
        suggestion: '→ Will appear in Focus tab daily'
      }
    }
    
    // Weekly frequency patterns
    const weeklyMatch = lower.match(/(\d+)x?\s*(per\s*week|weekly|times?\s*per\s*week|days?\s*per\s*week)/i)
    if (weeklyMatch) {
      return {
        title: text,
        isHabit: true,
        habitType: 'weekly',
        suggestion: `→ Will show ${weeklyMatch[1]} bubbles in Focus tab`
      }
    }
    
    // Monthly or outcome patterns
    if (/(lose|gain|save|earn|reach|achieve|complete|finish|launch|get)/i.test(lower) || 
        /(month|year|by|target|goal)/i.test(lower)) {
      return {
        title: text,
        isHabit: false,
        habitType: 'outcome',
        suggestion: '→ Progress tracked in OKRs tab'
      }
    }
    
    // Default to weekly if unclear
    return {
      title: text,
      isHabit: true,
      habitType: 'weekly',
      suggestion: '→ Check this if it\'s a regular activity'
    }
  }

  function processAllKRs() {
    const allKRs: ParsedKR[] = []
    
    // Process activities as habits
    activities.filter(a => a.trim()).forEach(activity => {
      allKRs.push(analyzeKR(activity))
    })
    
    // Process outcomes as results
    outcomes.filter(o => o.trim()).forEach(outcome => {
      allKRs.push(analyzeKR(outcome))
    })
    
    setParsedKRs(allKRs)
  }

  function updateActivity(index: number, value: string) {
    const newActivities = [...activities]
    newActivities[index] = value
    setActivities(newActivities)
  }

  function addActivity() {
    setActivities([...activities, ''])
  }

  function removeActivity(index: number) {
    setActivities(activities.filter((_, i) => i !== index))
  }

  function updateOutcome(index: number, value: string) {
    const newOutcomes = [...outcomes]
    newOutcomes[index] = value
    setOutcomes(newOutcomes)
  }

  function addOutcome() {
    setOutcomes([...outcomes, ''])
  }

  function removeOutcome(index: number) {
    setOutcomes(outcomes.filter((_, i) => i !== index))
  }

  function toggleKRType(index: number) {
    const newKRs = [...parsedKRs]
    newKRs[index].isHabit = !newKRs[index].isHabit
    newKRs[index].suggestion = newKRs[index].isHabit 
      ? '→ Will appear in Focus tab'
      : '→ Progress tracked in OKRs tab'
    setParsedKRs(newKRs)
  }

  async function createObjective() {
    setIsCreating(true)
    
    try {
      // Create objective
      const { data: objectiveData } = await supabase
        .from('annual_objectives')
        .insert({
          name: objectiveName,
          color: selectedColor,
          sort_order: objectives.length,
          status: 'active',
          space_id: activeSpaceId
        })
        .select()
        .single()

      if (objectiveData) {
        // Create key results. Metric fields default to null/false — metric
        // config is opt-in via the edit modal after creation.
        const keyResultsToInsert = parsedKRs.map((kr, index) => ({
          space_id: activeSpaceId,
          annual_objective_id: objectiveData.id,
          title: kr.title,
          quarter: ACTIVE_Q,
          sort_order: index,
          status: 'active' as const,
          health_status: 'not_started' as const,
          progress: 0,
          is_parked: false,
          is_habit: kr.isHabit,
          is_metric: false,
          metric_unit: null,
          metric_direction: null,
          start_value: null,
          target_value: null,
          target_date: null,
          created_at: new Date().toISOString()
        }))

        if (keyResultsToInsert.length > 0) {
          await supabase.from('roadmap_items').insert(keyResultsToInsert)
        }

        onSave(objectiveData, keyResultsToInsert)
      }
    } catch (error) {
      console.error('Failed to create objective:', error)
    }
    
    setIsCreating(false)
  }

  function renderStep() {
    switch (step) {
      case 'goal':
        return (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--navy-200)', marginBottom: 16 }}>
              🎯 What do you want to achieve?
            </h3>
            <div className="field">
              <label>Objective Name</label>
              <input
                className="input"
                value={objectiveName}
                onChange={e => setObjectiveName(e.target.value)}
                placeholder="e.g. Get in amazing shape"
                autoFocus
              />
            </div>
            <div className="field">
              <label>Tell me more about this goal</label>
              <textarea
                className="input"
                rows={4}
                value={goalDescription}
                onChange={e => setGoalDescription(e.target.value)}
                placeholder="Describe what you want to achieve and why it matters to you..."
              />
            </div>
          </div>
        )

      case 'activities':
        return (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--navy-200)', marginBottom: 8 }}>
              🏃 What regular activities will you do?
            </h3>
            <p style={{ fontSize: 13, color: 'var(--navy-400)', marginBottom: 16 }}>
              These become habits you can track daily/weekly in the Focus tab
            </p>
            
            {activities.map((activity, index) => (
              <div key={index} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                  className="input"
                  value={activity}
                  onChange={e => updateActivity(index, e.target.value)}
                  placeholder="e.g. Go to gym 4x per week"
                  style={{ flex: 1 }}
                />
                {activities.length > 1 && (
                  <button
                    onClick={() => removeActivity(index)}
                    className="btn"
                    style={{ padding: '8px 12px', fontSize: 12 }}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            
            <button
              onClick={addActivity}
              className="btn"
              style={{ fontSize: 12, marginBottom: 16 }}
            >
              + Add another activity
            </button>
          </div>
        )

      case 'outcomes':
        return (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--navy-200)', marginBottom: 8 }}>
              🏆 What results do you want to achieve?
            </h3>
            <p style={{ fontSize: 13, color: 'var(--navy-400)', marginBottom: 16 }}>
              These are measurable outcomes tracked in the OKRs tab
            </p>
            
            {outcomes.map((outcome, index) => (
              <div key={index} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                  className="input"
                  value={outcome}
                  onChange={e => updateOutcome(index, e.target.value)}
                  placeholder="e.g. Lose 20 pounds by December"
                  style={{ flex: 1 }}
                />
                {outcomes.length > 1 && (
                  <button
                    onClick={() => removeOutcome(index)}
                    className="btn"
                    style={{ padding: '8px 12px', fontSize: 12 }}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            
            <button
              onClick={addOutcome}
              className="btn"
              style={{ fontSize: 12 }}
            >
              + Add another outcome
            </button>
          </div>
        )

      case 'review':
        return (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--navy-200)', marginBottom: 16 }}>
              📋 Review Your Objective
            </h3>
            
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--navy-400)', marginBottom: 4 }}>Objective:</div>
              <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--navy-50)', marginBottom: 16 }}>
                {objectiveName}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--navy-400)', marginBottom: 8 }}>Key Results:</div>
              {parsedKRs.map((kr, index) => (
                <div
                  key={index}
                  style={{
                    background: 'var(--navy-700)',
                    border: '1px solid var(--navy-600)',
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12
                  }}
                >
                  <input
                    type="checkbox"
                    checked={kr.isHabit}
                    onChange={() => toggleKRType(index)}
                    style={{ width: 16, height: 16 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: 'var(--navy-200)', marginBottom: 4 }}>
                      {kr.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--navy-400)' }}>
                      {kr.suggestion}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <div style={{ fontSize: 12, color: 'var(--navy-400)', marginBottom: 8 }}>Color:</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {COLORS.map(color => (
                  <button
                    key={color}
                    onClick={() => setSelectedColor(color)}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: color,
                      border: selectedColor === color ? '3px solid var(--navy-50)' : '2px solid transparent',
                      cursor: 'pointer'
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  function getNextStep() {
    switch (step) {
      case 'goal':
        return 'activities'
      case 'activities':
        return 'outcomes'
      case 'outcomes':
        processAllKRs()
        return 'review'
      default:
        return 'review'
    }
  }

  function canProceed() {
    switch (step) {
      case 'goal':
        return objectiveName.trim().length > 0
      case 'activities':
        return activities.some(a => a.trim().length > 0)
      case 'outcomes':
        return outcomes.some(o => o.trim().length > 0)
      case 'review':
        return parsedKRs.length > 0
      default:
        return false
    }
  }

  const footerButtons = (
    <>
      <button className="btn" onClick={onClose}>Cancel</button>
      {step !== 'goal' && (
        <button
          className="btn"
          onClick={() => {
            if (step === 'activities') setStep('goal')
            if (step === 'outcomes') setStep('activities')
            if (step === 'review') setStep('outcomes')
          }}
        >
          Back
        </button>
      )}
      {step === 'review' ? (
        <button
          className="btn-primary"
          onClick={createObjective}
          disabled={!canProceed() || isCreating}
        >
          {isCreating ? 'Creating...' : 'Create Objective'}
        </button>
      ) : (
        <button
          className="btn-primary"
          onClick={() => setStep(getNextStep())}
          disabled={!canProceed()}
        >
          Next
        </button>
      )}
    </>
  )

  return (
    <Modal 
      title="🧭 Guided Objective Builder" 
      onClose={onClose}
      footer={footerButtons}
    >
      <div style={{ minHeight: '400px' }}>
        {renderStep()}
      </div>
    </Modal>
  )
}
