import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// role_level: 0=Guest, 1=Visitor, 2=User, 3=Host
const ROLE_LEVEL_MAP: Record<number, string> = {
  0: 'Guest',
  1: 'Visitor',
  2: 'User',
  3: 'Host',
}

const MENU_IDS: Record<string, string> = {
  guest:   'richmenu-b385e9a15da827b7a5183ba9f2423b8d',
  visitor: 'richmenu-2b37d4a1e18193a51580bed45e9dfb28',
  user:    'richmenu-ce44eafa7924d65357236b8f81f2be45',
  host:    'richmenu-5024f435bb8ef2f1a67f31bfc657deb4',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { user_id, role, role_level } = await req.json()

    if (!user_id) throw new Error('Missing user_id')

    // Derive role string from role_level (0-3) or use role directly
    const resolvedLevel: number = typeof role_level === 'number' ? role_level : -1
    const resolvedRole: string = (ROLE_LEVEL_MAP[resolvedLevel] ?? role ?? 'Guest').toLowerCase()

    console.log(`[switch-menu] user=${user_id} role=${resolvedRole} level=${resolvedLevel}`)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. อัปเดต Database: role (string) และ role_level (int 0-3)
    const updatePayload: Record<string, any> = {
      role: ROLE_LEVEL_MAP[resolvedLevel] ?? role ?? 'Guest',
    }
    if (resolvedLevel >= 0) updatePayload.role_level = resolvedLevel

    const { error: dbError } = await supabase
      .from('profiles')
      .update(updatePayload)
      .eq('id', user_id)

    if (dbError) throw dbError

    // 2. ดึง line_id เพื่อเปลี่ยน Rich Menu ของ LINE OA
    const { data: profileData } = await supabase
      .from('profiles')
      .select('line_id')
      .eq('id', user_id)
      .single()

    const channelAccessToken = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')
    const targetMenuId = MENU_IDS[resolvedRole] ?? MENU_IDS['guest']

    if (profileData?.line_id && channelAccessToken) {
      const lineUrl = `https://api.line.me/v2/bot/user/${profileData.line_id}/richmenu/${targetMenuId}`
      const lineRes = await fetch(lineUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${channelAccessToken}` }
      })
      if (!lineRes.ok) {
        const errText = await lineRes.text()
        console.error('LINE API Error:', errText)
        // ไม่ throw เพราะ DB อัปเดตสำเร็จแล้ว แค่ log ไว้
      }
    } else {
      console.warn('[switch-menu] Skipping LINE switch: no line_id or token')
    }

    return new Response(
      JSON.stringify({ success: true, role: updatePayload.role, role_level: resolvedLevel }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('[switch-menu] Error:', error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})