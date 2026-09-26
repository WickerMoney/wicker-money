import type { FastifyInstance } from 'fastify'
import type { Services } from '../../composition/Services.js'
import { registerAddStarterCategories } from './handlers/addStarterCategories.js'
import { registerCreateCategory } from './handlers/createCategory.js'
import { registerCreateCategoryRule } from './handlers/createCategoryRule.js'
import { registerDeleteCategory } from './handlers/deleteCategory.js'
import { registerDeleteCategoryRule } from './handlers/deleteCategoryRule.js'
import { registerGetCategoryCatalog } from './handlers/getCategoryCatalog.js'
import { registerGetCategoryUsage } from './handlers/getCategoryUsage.js'
import { registerListCategories } from './handlers/listCategories.js'
import { registerListCategoryRules } from './handlers/listCategoryRules.js'
import { registerPreviewCategoryRule } from './handlers/previewCategoryRule.js'
import { registerUpdateCategory } from './handlers/updateCategory.js'

export type { CategoryUsage } from '../service/CategoryUsage.js'

/**
 * Registers every category and category-rule endpoint under `/api/v1`.
 *
 * @param app - The Fastify instance to register routes on.
 * @param services - The application services.
 */
export function registerCategoryRoutes(app: FastifyInstance, { categories, categoryRules }: Services): void {
  registerListCategories(app, categories)
  registerCreateCategory(app, categories)
  registerGetCategoryCatalog(app, categories)
  registerAddStarterCategories(app, categories)
  registerUpdateCategory(app, categories)
  registerGetCategoryUsage(app, categories)
  registerDeleteCategory(app, categories)
  registerListCategoryRules(app, categoryRules)
  registerCreateCategoryRule(app, categoryRules)
  registerPreviewCategoryRule(app, categoryRules)
  registerDeleteCategoryRule(app, categoryRules)
}
