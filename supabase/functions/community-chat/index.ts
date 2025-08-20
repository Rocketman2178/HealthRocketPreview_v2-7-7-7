import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
}

interface CommunityMessage {
  id: string;
  community_id: string;
  user_id: string;
  content: string;
  media_url?: string;
  media_type?: 'image' | 'video';
  parent_message_id?: string;
  reply_count: number;
  created_at: string;
  updated_at: string;
  user_name: string;
  user_avatar_url?: string;
}

interface CommunityMember {
  id: string;
  name: string;
  avatarUrl?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Create Supabase client with service role key (bypasses RLS)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    const url = new URL(req.url)
    const action = url.searchParams.get('action')
    const communityId = url.searchParams.get('community_id')

    // Get user from Authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Authorization header required')
    }

    // Create regular client to verify user
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )

    if (userError || !user) {
      throw new Error('Invalid user token')
    }

    switch (action) {
      case 'get_members': {
        if (!communityId) {
          throw new Error('Community ID required')
        }

        // First verify user is a member of this community
        const { data: membership, error: membershipError } = await supabaseAdmin
          .from('community_memberships')
          .select('id')
          .eq('user_id', user.id)
          .eq('community_id', communityId)
          .single()

        if (membershipError || !membership) {
          throw new Error('User is not a member of this community')
        }

        // Get community members using service role (bypasses RLS)
        const { data: memberships, error: membersError } = await supabaseAdmin
          .from('community_memberships')
          .select(`
            user_id,
            users (
              id,
              name,
              avatar_url
            )
          `)
          .eq('community_id', communityId)

        if (membersError) {
          throw new Error(`Failed to fetch members: ${membersError.message}`)
        }

        const members: CommunityMember[] = memberships
          ?.map(m => ({
            id: m.users.id,
            name: m.users.name || 'Unknown User',
            avatarUrl: m.users.avatar_url
          }))
          .filter(Boolean) || []

        return new Response(
          JSON.stringify({ success: true, members }),
          { 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      }

      case 'get_messages': {
        if (!communityId) {
          throw new Error('Community ID required')
        }

        const limit = parseInt(url.searchParams.get('limit') || '50')
        const offset = parseInt(url.searchParams.get('offset') || '0')

        // First verify user is a member of this community
        const { data: membership, error: membershipError } = await supabaseAdmin
          .from('community_memberships')
          .select('id')
          .eq('user_id', user.id)
          .eq('community_id', communityId)
          .single()

        if (membershipError || !membership) {
          throw new Error('User is not a member of this community')
        }

        // Get messages using service role (bypasses RLS)
        const { data: messages, error: messagesError } = await supabaseAdmin
          .from('community_chat_messages')
          .select(`
            id,
            community_id,
            user_id,
            content,
            media_url,
            media_type,
            parent_message_id,
            reply_count,
            created_at,
            updated_at,
            user_name
          `)
          .eq('community_id', communityId)
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1)

        if (messagesError) {
          throw new Error(`Failed to fetch messages: ${messagesError.message}`)
        }

        // Get user avatar URLs separately to avoid RLS issues
        const userIds = [...new Set(messages?.map(m => m.user_id) || [])]
        const { data: users } = await supabaseAdmin
          .from('users')
          .select('id, avatar_url')
          .in('id', userIds)

        const userAvatarMap = new Map()
        users?.forEach(u => userAvatarMap.set(u.id, u.avatar_url))

        const formattedMessages: CommunityMessage[] = messages?.map(msg => ({
          id: msg.id,
          community_id: msg.community_id,
          user_id: msg.user_id,
          content: msg.content,
          media_url: msg.media_url,
          media_type: msg.media_type,
          parent_message_id: msg.parent_message_id,
          reply_count: msg.reply_count || 0,
          created_at: msg.created_at,
          updated_at: msg.updated_at,
          user_name: msg.user_name || 'Unknown User',
          user_avatar_url: userAvatarMap.get(msg.user_id)
        })) || []

        return new Response(
          JSON.stringify({ success: true, messages: formattedMessages }),
          { 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      }

      case 'send_message': {
        if (req.method !== 'POST') {
          throw new Error('POST method required for sending messages')
        }

        const body = await req.json()
        const { communityId: msgCommunityId, content, mediaUrl, mediaType, parentMessageId } = body

        if (!msgCommunityId || !content?.trim()) {
          throw new Error('Community ID and content are required')
        }

        // First verify user is a member of this community
        const { data: membership, error: membershipError } = await supabaseAdmin
          .from('community_memberships')
          .select('id')
          .eq('user_id', user.id)
          .eq('community_id', msgCommunityId)
          .single()

        if (membershipError || !membership) {
          throw new Error('User is not a member of this community')
        }

        // Get user name for the message
        const { data: userData, error: userDataError } = await supabaseAdmin
          .from('users')
          .select('name')
          .eq('id', user.id)
          .single()

        if (userDataError) {
          throw new Error('Failed to get user data')
        }

        // Insert message using service role (bypasses RLS)
        const { data: newMessage, error: insertError } = await supabaseAdmin
          .from('community_chat_messages')
          .insert({
            user_id: user.id,
            community_id: msgCommunityId,
            content: content.trim(),
            media_url: mediaUrl,
            media_type: mediaType,
            parent_message_id: parentMessageId,
            user_name: userData.name || 'Unknown User'
          })
          .select(`
            id,
            community_id,
            user_id,
            content,
            media_url,
            media_type,
            created_at,
            parent_message_id,
            reply_count,
            updated_at,
            user_name
          `)
          .single()

        if (insertError) {
          throw new Error(`Failed to insert message: ${insertError.message}`)
        }

        // Get user avatar URL
        const { data: userAvatar } = await supabaseAdmin
          .from('users')
          .select('avatar_url')
          .eq('id', user.id)
          .single()

        const message: CommunityMessage = {
          id: newMessage.id,
          community_id: newMessage.community_id,
          user_id: newMessage.user_id,
          content: newMessage.content,
          media_url: newMessage.media_url,
          media_type: newMessage.media_type,
          parent_message_id: newMessage.parent_message_id,
          reply_count: newMessage.reply_count || 0,
          created_at: newMessage.created_at,
          updated_at: newMessage.updated_at,
          user_name: newMessage.user_name,
          user_avatar_url: userAvatar?.avatar_url
        }

        return new Response(
          JSON.stringify({ success: true, message }),
          { 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      }

      case 'delete_message': {
        if (req.method !== 'POST') {
          throw new Error('POST method required for deleting messages')
        }

        const body = await req.json()
        const { messageId } = body

        if (!messageId) {
          throw new Error('Message ID required')
        }

        // Delete message using service role (bypasses RLS)
        const { error: deleteError } = await supabaseAdmin
          .from('community_chat_messages')
          .delete()
          .eq('id', messageId)
          .eq('user_id', user.id) // Users can only delete their own messages

        if (deleteError) {
          throw new Error(`Failed to delete message: ${deleteError.message}`)
        }

        return new Response(
          JSON.stringify({ success: true }),
          { 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      }

      default:
        throw new Error('Invalid action parameter')
    }

  } catch (error) {
    console.error('Community chat function error:', error)
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { 
        status: 400,
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  }
})