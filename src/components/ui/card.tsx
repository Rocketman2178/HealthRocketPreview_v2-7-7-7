import { cn } from '../../lib/utils';
import { CardProps } from '../../types/dashboard';

export function Card({ title, children, className ,id=""}: CardProps) {
  return (
    <div className={cn(
      "flex flex-col justify-between bg-gray-800/30 backdrop-blur-sm rounded-xl border border-gray-700/30 p-4 shadow-lg",
      className
    )} id={id}>
      {children}
    </div>
  );
}