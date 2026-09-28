import { useSelector } from 'react-redux'
import { useConfig } from '@/store/context/ConfigContext'

/**
 * VibeFlow UI profile.
 *
 * `VIBEFLOW_UI_PROFILE` drives which Flowise entries are exposed in the VibeFlow sidebar:
 *  - 'vibeflow' (default): Chatflows and Assistants are hidden, AgentFlow V1 is not selectable.
 *  - 'upstream': original Flowise sidebar, kept for advanced/debug use.
 *
 * Routes are never removed, only the menu entries are hidden.
 */
export const VIBEFLOW_DEFAULT_UI_PROFILE = 'vibeflow'

export const VIBEFLOW_SIDEBAR_PROFILE = {
    'vibeflow:chatflows': ['upstream'],
    'vibeflow:assistants': ['upstream']
}

export const vibeflowProfile = (config) => (config?.VIBEFLOW_UI_PROFILE || VIBEFLOW_DEFAULT_UI_PROFILE).toLowerCase()

export const useAuth = () => {
    const { isOpenSource, config } = useConfig()
    const permissions = useSelector((state) => state.auth.permissions)
    const features = useSelector((state) => state.auth.features)
    const isGlobal = useSelector((state) => state.auth.isGlobal)
    const currentUser = useSelector((state) => state.auth.user)

    const hasPermission = (permissionId) => {
        if (isOpenSource || isGlobal) {
            return true
        }
        if (!permissionId) return false
        const permissionIds = permissionId.split(',')
        if (permissions && permissions.length) {
            return permissionIds.some((permissionId) => permissions.includes(permissionId))
        }
        return false
    }

    const hasAssignedWorkspace = (workspaceId) => {
        if (isOpenSource || isGlobal) {
            return true
        }
        const activeWorkspaceId = currentUser?.activeWorkspaceId || ''
        if (workspaceId === activeWorkspaceId) {
            return true
        }
        return false
    }

    const hasDisplay = (display) => {
        if (!display) {
            return true
        }

        // VibeFlow: entries driven by VIBEFLOW_UI_PROFILE are resolved locally, on every edition.
        if (Object.prototype.hasOwnProperty.call(VIBEFLOW_SIDEBAR_PROFILE, display)) {
            return VIBEFLOW_SIDEBAR_PROFILE[display].includes(vibeflowProfile(config))
        }

        // if it has display flag, but user has no features, then it should not be displayed
        if (!features || Array.isArray(features) || Object.keys(features).length === 0) {
            return false
        }

        // check if the display flag is in the features
        if (Object.hasOwnProperty.call(features, display)) {
            const flag = features[display] === 'true' || features[display] === true
            return flag
        }

        return false
    }

    return { hasPermission, hasAssignedWorkspace, hasDisplay }
}
