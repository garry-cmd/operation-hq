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

interface Message {
  role: 'assistant' | 'user'
  content: string
}

interface ParsedObjective {
  name: string
  keyResults: Array<{
    title: string
    isHabit: boolean
    habitType: 'daily' | 'weekly' | 'monthly' | 'outcome'
  }>
}

export default function AIObjectiveBuilder({ objectives, activeSpaceId, onClose, onSave }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "Hi! I'll help you create a well-structured objective with key results. Tell me about something you want to achieve this year - it could be fitness, career, learning, or anything important to you!"
    }
  ])
  const [userInput, setUserInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [parsedObjective, setParsedObjective] = useState<ParsedObjective | null>(null)
  const [selectedColor, setSelectedColor] = useState(COLORS[objectives.length % COLORS.length])

  async function sendMessage() {
    if (!userInput.trim() || isLoading) return

    const newMessages: Message[] = [
      ...messages,
      { role: 'user', content: userInput.trim() }
    ]

    setMessages(newMessages)
    setUserInput('')
    setIsLoading(true)

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content: `You are an expert at creating well-structured OKRs (Objectives and Key Results). Help the user build their objective by having a conversation with them.

IMPORTANT GUIDELINES:
- Ask clarifying questions to understand their goal
- Help them distinguish between habits (daily/weekly activities) and outcomes (measurable results)
- Suggest specific, measurable key results
- Keep the conversation natural and helpful
- When ready, suggest a complete objective structure

HABIT PATTERNS TO RECOGNIZE:
- Daily habits: "exercise daily", "read every day", "meditate daily"  
- Weekly habits: "gym 3x per week", "write 2 articles per week", "call friends weekly"
- Monthly/outcome goals: "lose 20 pounds", "save $5000", "launch product", "get promoted"

CURRENT CONVERSATION:
${newMessages.map(m => `${m.role}: ${m.content}`).join('\n')}

If you think you have enough information to suggest a complete objective structure, format your response like this:

OBJECTIVE_READY: {
  "name": "The objective title",
  "keyResults": [
    {
      "title": "Specific key result title",
      "isHabit": true/false,
      "habitType": "daily" | "weekly" | "monthly" | "outcome"
    }
  ]
}

Otherwise, continue the conversation naturally by asking questions or providing guidance.`
            }
          ]
        })
      })

      const data = await response.json()
      const assistantMessage = data.content[0].text

      // Check if AI provided a complete objective structure
      if (assistantMessage.includes('OBJECTIVE_READY:')) {
        const jsonMatch = assistantMessage.match(/OBJECTIVE_READY:\s*(\{[\s\S]*?\})/)
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[1])
            setParsedObjective(parsed)
            setMessages([...newMessages, {
              role: 'assistant',
              content: assistantMessage.replace(/OBJECTIVE_READY:[\s\S]*/, 'Perfect! I\'ve structured your objective. You can review and create it below, or continue chatting to refine it further.')
            }])
          } catch (e) {
            console.error('Failed to parse objective:', e)
            setMessages([...newMessages, { role: 'assistant', content: assistantMessage }])
          }
        }
      } else {
        setMessages([...newMessages, { role: 'assistant', content: assistantMessage }])
      }
    } catch (error) {
      console.error('AI request failed:', error)
      setMessages([...newMessages, {
        role: 'assistant',
        content: "Sorry, I'm having trouble connecting. Could you try describing your goal again?"
      }])
    }

    setIsLoading(false)
  }

  async function createObjective() {
    if (!parsedObjective) return

    setIsLoading(true)
    try {
      // Create objective
      const { data: objectiveData } = await supabase
        .from('annual_objectives')
        .insert({
          name: parsedObjective.name,
          color: selectedColor,
          sort_order: objectives.length,
          status: 'active',
          space_id: activeSpaceId
        })
        .select()
        .single()

      if (objectiveData) {
        // Create key results. New metric fields default to null/false — KRs
        // created via AI builder are always plain outcomes or habits; metric
        // config is opt-in via the edit modal after creation.
        const keyResultsToInsert = parsedObjective.keyResults.map((kr, index) => ({
          space_id: activeSpaceId,
          annual_objective_id: objectiveData.id,
          title: kr.title,
          quarter: kr.habitType === 'outcome' ? ACTIVE_Q : ACTIVE_Q, // All start in active quarter
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
    setIsLoading(false)
  }

  return (
    <Modal 
      title="🤖 AI Objective Builder" 
      onClose={onClose}
      footer={parsedObjective ? (
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button 
            className="btn-primary" 
            onClick={createObjective}
            disabled={isLoading}
          >
            {isLoading ? 'Creating...' : 'Create Objective'}
          </button>
        </>
      ) : (
        <button className="btn" onClick={onClose}>Cancel</button>
      )}
    >
      <div style={{ height: '60vh', display: 'flex', flexDirection: 'column' }}>
        {/* Chat Messages */}
        <div style={{ 
          flex: 1, 
          overflowY: 'auto', 
          marginBottom: 16,
          padding: '0 4px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}>
          {messages.map((message, index) => (
            <div
              key={index}
              style={{
                alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                padding: '12px 16px',
                borderRadius: 16,
                background: message.role === 'user' 
                  ? 'var(--accent)' 
                  : 'var(--navy-700)',
                color: message.role === 'user' ? 'white' : 'var(--navy-200)',
                fontSize: 14,
                lineHeight: 1.4,
                whiteSpace: 'pre-wrap'
              }}
            >
              {message.content}
            </div>
          ))}
          {isLoading && (
            <div style={{
              alignSelf: 'flex-start',
              padding: '12px 16px',
              borderRadius: 16,
              background: 'var(--navy-700)',
              color: 'var(--navy-400)',
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}>
              <div style={{
                width: 16,
                height: 16,
                borderRadius: '50%',
                border: '2px solid var(--navy-600)',
                borderTopColor: 'var(--accent)',
                animation: 'spin 0.8s linear infinite'
              }} />
              AI is thinking...
            </div>
          )}
        </div>

        {/* Parsed Objective Preview */}
        {parsedObjective && (
          <div style={{
            background: 'var(--navy-700)',
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
            border: '1px solid var(--navy-600)'
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy-200)', marginBottom: 12 }}>
              📋 Structured Objective
            </div>
            
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--navy-400)', marginBottom: 4 }}>Objective:</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--navy-50)' }}>
                {parsedObjective.name}
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--navy-400)', marginBottom: 8 }}>Key Results:</div>
              {parsedObjective.keyResults.map((kr, index) => (
                <div key={index} style={{
                  fontSize: 13,
                  color: 'var(--navy-200)',
                  marginBottom: 4,
                  paddingLeft: 8,
                  borderLeft: '2px solid var(--navy-600)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }}>
                  <span style={{ flex: 1 }}>{kr.title}</span>
                  {kr.isHabit && (
                    <span style={{
                      fontSize: 10,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: kr.habitType === 'daily' || kr.habitType === 'weekly' 
                        ? 'var(--teal-bg)' 
                        : 'var(--navy-600)',
                      color: kr.habitType === 'daily' || kr.habitType === 'weekly'
                        ? 'var(--teal-text)'
                        : 'var(--navy-300)'
                    }}>
                      {kr.habitType === 'daily' || kr.habitType === 'weekly' ? 'Focus Tab' : 'OKRs Only'}
                    </span>
                  )}
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
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: color,
                      border: selectedColor === color ? '2px solid var(--navy-50)' : '1px solid var(--navy-600)',
                      cursor: 'pointer'
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Chat Input */}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={userInput}
            onChange={e => setUserInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage()}
            placeholder="Describe your goal..."
            className="input"
            style={{ flex: 1, fontSize: 14 }}
            autoFocus
            disabled={isLoading}
          />
          <button
            onClick={sendMessage}
            disabled={!userInput.trim() || isLoading}
            className="btn-primary"
            style={{ padding: '8px 16px', fontSize: 14 }}
          >
            Send
          </button>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </Modal>
  )
}
