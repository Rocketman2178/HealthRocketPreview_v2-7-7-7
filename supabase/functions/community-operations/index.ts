import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
}

interface CommunityMember {
  user_id: string;
  user_name: string;
  avatar_url?: string;
  joined_at: string;
}

interface MessageReaction {
  reaction_id: string;
  user_id: string;
  user_name: string;
  created_at: string;
}

interface VerifyMembershipResponse {
  is_member: boolean;
  error?: string;
}

interface GetMembersResponse {
  success: boolean;
  members?: CommunityMember[];
  error?: string;
}

interface GetReactionsResponse {
  success: boolean;
  reactions?: MessageReaction[];
  error?: string;
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

    // Create regular client to verify user authentication
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )

    const url = new URL(req.url)
    const operation = url.searchParams.get('operation')

    // Get user from Authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Authorization header required')
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )

    if (userError || !user) {
      throw new Error('Invalid user token')
    }

    switch (operation) {
      case 'verify_membership': {
        const communityId = url.searchParams.get('community_id')
        
        if (!communityId) {
          throw new Error('Community ID required')
        }

        // Use the dedicated function to verify membership
        const { data: isMember, error } = await supabaseAdmin
          .rpc('verify_community_membership', {
            p_user_id: user.id,
            p_community_id: communityId
          })

        if (error) {
          throw new Error(`Membership verification failed: ${error.message}`)
        }

        const response: VerifyMembershipResponse = {
          is_member: !!isMember
        }

        return new Response(
          JSON.stringify(response),
          { 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      }

      case 'get_members': {
        const communityId = url.searchParams.get('community_id')
        
        if (!communityId) {
          throw new Error('Community ID required')
        }

        // First verify user is a member of this community
        const { data: isMember, error: membershipError } = await supabaseAdmin
          .rpc('verify_community_membership', {
            p_user_id: user.id,
            p_community_id: communityId
          })

        if (membershipError || !isMember) {
          throw new Error('User is not a member of this community')
        }

        // Get community members using the dedicated function
        const { data: members, error: membersError } = await supabaseAdmin
          .rpc('get_community_members_list', {
            p_community_id: communityId
          })

        if (membersError) {
          throw new Error(`Failed to fetch members: ${membersError.message}`)
        }

        const response: GetMembersResponse = {
          success: true,
          members: members?.map(member => ({
            user_id: member.user_id,
            user_name: member.user_name || 'Unknown User',
            avatar_url: member.avatar_url,
            joined_at: member.joined_at
          })) || []
        }

        return new Response(
          JSON.stringify(response),
          { 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      }

      case 'get_message_reactions': {
        const messageId = url.searchParams.get('message_id')
        
        if (!messageId) {
          throw new Error('Message ID required')
        }

        // First verify the message exists and get its community
        const { data: messageData, error: messageError } = await supabaseAdmin
          .from('community_chat_messages')
          .select('community_id')
          .eq('id', messageId)
          .single()

        if (messageError || !messageData) {
          throw new Error('Message not found')
        }

        // Verify user is a member of the message's community
        const { data: isMember, error: membershipError } = await supabaseAdmin
          .rpc('verify_community_membership', {
            p_user_id: user.id,
            p_community_id: messageData.community_id
          })

        if (membershipError || !isMember) {
          throw new Error('User is not a member of this community')
        }

        // Get message reactions using the dedicated function
        const { data: reactions, error: reactionsError } = await supabaseAdmin
          .rpc('get_message_reactions_with_users', {
            p_message_id: messageId
          })

        if (reactionsError) {
          throw new Error(`Failed to fetch reactions: ${reactionsError.message}`)
        }

        const response: GetReactionsResponse = {
          success: true,
          reactions: reactions?.map(reaction => ({
            reaction_id: reaction.reaction_id,
            user_id: reaction.user_id,
            user_name: reaction.user_name || 'Unknown User',
            created_at: reaction.created_at
          })) || []
        }

        return new Response(
          JSON.stringify(response),
          { 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      }

      case 'toggle_reaction': {
        if (req.method !== 'POST') {
          throw new Error('POST method required for toggling reactions')
        }

        const body = await req.json()
        const { messageId } = body

        if (!messageId) {
          throw new Error('Message ID required')
        }

        // First verify the message exists and get its community
        const { data: messageData, error: messageError } = await supabaseAdmin
          .from('community_chat_messages')
          .select('community_id')
          .eq('id', messageId)
          .single()

        if (messageError || !messageData) {
          throw new Error('Message not found')
        }

        // Verify user is a member of the message's community
        const { data: isMember, error: membershipError } = await supabaseAdmin
          .rpc('verify_community_membership', {
            p_user_id: user.id,
            p_community_id: messageData.community_id
          })

        if (membershipError || !isMember) {
          throw new Error('User is not a member of this community')
        }

        // Check if user already reacted to this message
        const { data: existingReaction, error: checkError } = await supabaseAdmin
          .from('community_message_reactions')
          .select('id')
          .eq('message_id', messageId)
          .eq('user_id', user.id)
          .maybeSingle()

        if (checkError) {
          throw new Error(`Failed to check existing reaction: ${checkError.message}`)
        }

        let reactionAdded = false;

        if (existingReaction) {
          // Remove existing reaction
          const { error: deleteError } = await supabaseAdmin
            .from('community_message_reactions')
            .delete()
            .eq('id', existingReaction.id)

          if (deleteError) {
            throw new Error(`Failed to remove reaction: ${deleteError.message}`)
          }
          
          reactionAdded = false;
        } else {
          // Add new reaction
          const { error: insertError } = await supabaseAdmin
            .from('community_message_reactions')
            .insert({
              message_id: messageId,
              user_id: user.id
            })

          if (insertError) {
            throw new Error(`Failed to add reaction: ${insertError.message}`)
          }
          
          reactionAdded = true;
        }

        return new Response(
          JSON.stringify({ 
            success: true, 
            reaction_added: reactionAdded 
          }),
          { 
            headers: { 
              ...corsHeaders, 
              'Content-Type': 'application/json' 
            } 
          }
        )
      }

      default:
        throw new Error('Invalid operation parameter. Supported: verify_membership, get_members, get_message_reactions, toggle_reaction')
    }

  } catch (error) {
    console.error('Community operations function error:', error)
    
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