import React, { useState } from 'react';
import { X, Target, Award, Calendar } from 'lucide-react';
import { useCompletedActivities } from '../../../hooks/useCompletedActivities';
import { useQuestLibrary } from '../../../hooks/useQuestLibrary';
import { useSupabase } from '../../../contexts/SupabaseContext';

export function CompletedQuestsModal({ onClose }: { onClose: () => void }) {
  const { user } = useSupabase();
  const { data, loading } = useCompletedActivities(user?.id);
  const { quests } = useQuestLibrary();

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-lg max-w-xl w-full">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Target className="text-orange-500" size={20} />
            <h2 className="text-lg font-semibold text-white">Quest History</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-300"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-orange-500" />
            </div>
          ) : !data?.quests?.length ? (
            <div className="text-center py-8">
              <Award className="text-orange-500 mx-auto mb-3" size={24} />
              <p className="text-gray-400">No completed quests yet</p>
              <p className="text-sm text-gray-500 mt-2">Complete quests to see them here</p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.quests.map(quest => (
                <div 
                  key={quest.id}
                  className="bg-gray-700/50 rounded-lg p-3"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Target className="text-orange-500" size={16} />
                      <span className="text-sm text-white">
                        {quests.find(q => q.id === quest.quest_id)?.name || quest.quest_id}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-orange-500">
                      <Award size={14} />
                      <span className="text-sm">+{quest.fp_earned} FP</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <div className="flex items-center gap-1.5">
                      <Calendar size={12} />
                      <span>
                        {new Date(quest.completed_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}
                      </span>
                    </div>
                    <span>
                      {quest.challenges_completed} Challenges • {quest.boosts_completed} Boosts
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}