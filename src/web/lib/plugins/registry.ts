import type { AlgoPlugin, PluginCategory } from './types';

class PluginRegistry {
  private plugins: Map<string, AlgoPlugin> = new Map();

  /**
   * Register a plugin. Throws if a plugin with the same id already exists.
   */
  register(plugin: AlgoPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin "${plugin.id}" is already registered.`);
    }
    this.plugins.set(plugin.id, plugin);
  }

  /**
   * Get a plugin by its id. Returns undefined if not found.
   */
  get(id: string): AlgoPlugin | undefined {
    return this.plugins.get(id);
  }

  /**
   * Get all plugins belonging to a specific category.
   */
  getByCategory<T extends AlgoPlugin = AlgoPlugin>(category: PluginCategory): T[] {
    const result: T[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.category === category) {
        result.push(plugin as T);
      }
    }
    return result;
  }

  /**
   * List all registered plugins.
   */
  list(): AlgoPlugin[] {
    return Array.from(this.plugins.values());
  }
}

export const pluginRegistry = new PluginRegistry();
