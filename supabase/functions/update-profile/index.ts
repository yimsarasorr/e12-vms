import "@supabase/functions-js/edge-runtime.d.ts"
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    // รับ userId (เป้าหมาย) และ updateData จาก Frontend
    const { userId, updateData } = await req.json()

    if (!userId || !updateData || Object.keys(updateData).length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing userId or updateData' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // 1. ตรวจสอบผู้ใช้งานที่ส่ง Request (Actor)
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    // 2. ดึงชื่อคนทำรายการมาเก็บใน Log
    const { data: actorProfile } = await supabaseClient
      .from('profiles')
      .select('name')
      .eq('id', user.id)
      .single()

    // 3. เรียกใช้ RPC 
    const { data, error } = await supabaseClient.rpc(
      'update_profile_with_log',
      {
        p_user_id: userId,                   // คนที่ถูกแก้
        p_actor_id: user.id,                 // คนที่กดคำสั่งแก้
        p_actor_name: actorProfile?.name ?? user.email, 
        p_updates: updateData
      }
    )

    if (error) throw error

    return new Response(
      JSON.stringify(data),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error: any) {
    console.error('Edge Function Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})