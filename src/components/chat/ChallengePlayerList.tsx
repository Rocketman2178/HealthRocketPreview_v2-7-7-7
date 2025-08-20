import { useState } from 'react';
import { User, Search, X, Trophy, Users, Building2 } from 'lucide-react';
import { PlayerProfileModal } from '../dashboard/rank/PlayerProfileModal';
import type { LeaderboardEntry } from '../../types/community';

interface ChallengePlayerListProps {
  players: LeaderboardEntry[];
  loading?: boolean;
  onClose: () => void;
  onPlayerSelect?: (player: LeaderboardEntry) => void;
  isContest?: boolean;
}

export function ChallengePlayerList({ players, loading, onClose, onPlayerSelect, isContest = false }: ChallengePlayerListProps) {
  const [selectedPlayer, setSelectedPlayer] = useState<LeaderboardEntry | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const handlePlayerSelect = async (player: LeaderboardEntry) => {
    // Ensure all required fields are present
    const completePlayer: LeaderboardEntry = {
      ...player,
      healthScore: player.healthScore || 7.8,  // Default to 7.8 if not provided
      healthspanYears: player.healthspanYears || 0,  // Default to 0 if not provided
      fuelPoints: player.fuelPoints || 0,  // Required by LeaderboardEntry type
      rank: player.rank || 0,  // Required by LeaderboardEntry type
      createdAt: player.createdAt || new Date().toISOString()  // Required by LeaderboardEntry type
    };

    if (onPlayerSelect) {
      onPlayerSelect(completePlayer);
    } else {
      setSelectedPlayer(completePlayer);
    }
  };

  // Filter and sort players
  const filteredPlayers = players
    .filter(player => 
      player.name.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div 
          className="w-full max-w-md max-h-[85vh] flex flex-col bg-gray-800 rounded-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-4 border-b border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">{isContest ? "Contest Players" : "Challenge Players"}</h2>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-300"
              >
                <X size={20} />
              </button>
            </div>

            {/* Search Bar */}
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                onClick={(e) => e.stopPropagation()}
                type="text"
                placeholder="Search players..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
          </div>

          {/* Player List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-orange-500" />
              </div>
            ) : filteredPlayers.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                No players found matching "{searchQuery}"
              </div>
            ) : (
              filteredPlayers.map(player => (
                <button
                  key={player.userId}
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePlayerSelect(player);
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-700/50 transition-colors text-left group cursor-pointer relative z-[201]"
                >
                  {player.avatarUrl ? (
                    <img
                      src={player.avatarUrl}
                      alt={player.name}
                      className="w-10 h-10 rounded-full object-cover group-hover:ring-2 group-hover:ring-orange-500 transition-all shrink-0 flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 bg-gray-700 rounded-full flex items-center justify-center group-hover:ring-2 group-hover:ring-orange-500 transition-all shrink-0">
                      <User className="text-gray-400" size={20} />
                    </div>
                  )}
                  <div>
                    <div className="text-white font-medium group-hover:text-orange-500 transition-colors">{player.name}</div>
                    <div className="flex items-center gap-0.5">
                      <span className="text-xs text-gray-400 mr-2">Level {player.level}</span>
                      {player.plan === 'Free Plan' ? (
                        <span className="text-[10px] text-orange-500">Free Plan</span>
                      ) : (
                        <div className="flex items-center gap-0.5 px-1 py-0.5 text-[10px] text-orange-500">
                          {player.plan === 'Pro Plan' && <Trophy size={10} />}
                          {player.plan === 'Pro+Family' && <Users size={10} />}
                          {player.plan === 'Pro+Team' && <Building2 size={10} />}
                          <span>{player.plan}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {selectedPlayer && !onPlayerSelect && (
        <div className="relative z-[202]">
          <PlayerProfileModal
            player={selectedPlayer}
            onClose={() => setSelectedPlayer(null)}
          />
        </div>
      )}
    </>
  );
}