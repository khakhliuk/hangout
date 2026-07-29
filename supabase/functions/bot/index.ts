import { createClient } from 'npm:@supabase/supabase-js@2'

const BOT_TOKEN = Deno.env.get('BOT_TOKEN')!
const WEBHOOK_SECRET = Deno.env.get('TG_WEBHOOK_SECRET')
const MINIAPP_LINK = Deno.env.get('MINIAPP_LINK') ?? 'https://t.me/hangoutappbot/app'
const BOT_USERNAME = 'hangoutappbot'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

async function tg(method: string, payload: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.json()
  if (!body.ok) console.error(`${method} failed:`, JSON.stringify(body))
  return body
}

async function upsertSpace(chat: { id: number; title?: string }, adminTgUserId: number): Promise<string> {
  const { data: existing } = await db.from('spaces').select('id').eq('tg_chat_id', chat.id).maybeSingle()
  if (existing) {
    await db.from('spaces').update({ title: chat.title ?? 'Компанія' }).eq('id', existing.id)
    return existing.id
  }
  const { data, error } = await db
    .from('spaces')
    .insert({ tg_chat_id: chat.id, title: chat.title ?? 'Компанія', admin_tg_user_id: adminTgUserId })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

async function onMyChatMember(m: {
  chat: { id: number; type: string; title?: string }
  from: { id: number }
  new_chat_member: { status: string }
}) {
  if (!['group', 'supergroup'].includes(m.chat.type)) return
  const status = m.new_chat_member.status
  if (status !== 'member' && status !== 'administrator') return

  const spaceId = await upsertSpace(m.chat, m.from.id)
  await tg('sendMessage', {
    chat_id: m.chat.id,
    text: `Привіт! Тепер у «${m.chat.title}» є свій спейс у Hangout.\n\nСтворюйте івенти, голосуйте за дату й місце — без хаосу на 200 повідомлень.`,
    reply_markup: {
      inline_keyboard: [[{ text: 'Приєднатись в Hangout', url: `${MINIAPP_LINK}?startapp=s_${spaceId}` }]],
    },
  })
}

async function onMessage(msg: {
  chat: { id: number; type: string }
  text?: string
  new_chat_title?: string
}) {
  if (msg.new_chat_title) {
    await db.from('spaces').update({ title: msg.new_chat_title }).eq('tg_chat_id', msg.chat.id)
    return
  }
  if (msg.chat.type === 'private' && msg.text?.startsWith('/start')) {
    await tg('sendMessage', {
      chat_id: msg.chat.id,
      text: 'Привіт! Я допомагаю компаніям друзів реально збиратись, а не тільки обговорювати це в чаті.\n\nДодай мене в груповий чат — і спейс вашої компанії створиться сам.',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Додати в чат', url: `https://t.me/${BOT_USERNAME}?startgroup=true` }],
          [{ text: 'Відкрити Hangout', url: `${MINIAPP_LINK}?startapp` }],
        ],
      },
    })
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('ok')
  }
  if (WEBHOOK_SECRET && req.headers.get('x-telegram-bot-api-secret-token') !== WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 })
  }

  const update = await req.json()
  try {
    if (update.my_chat_member) await onMyChatMember(update.my_chat_member)
    else if (update.message) await onMessage(update.message)
  } catch (e) {
    console.error('update handling failed:', e)
  }
  return new Response('ok')
})
