import { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'

// material-ui
import {
    Box,
    Button,
    Chip,
    IconButton,
    Paper,
    Skeleton,
    Stack,
    Switch,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tooltip,
    Typography
} from '@mui/material'

// project imports
import vibeflowSkillsApi from '@/api/vibeflowSkills'
import useApi from '@/hooks/useApi'

// icons
import { IconFileUpload, IconRefresh, IconTrash } from '@tabler/icons-react'
import ToolEmptySVG from '@/assets/images/tools_empty.svg'

// ==============================|| VIBEFLOW SKILLS TAB ||============================== //

const formatSize = (bytes) => {
    if (!bytes && bytes !== 0) return '-'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const SkillsTab = ({ setError }) => {
    const getAllSkillsApi = useApi(vibeflowSkillsApi.getAllSkills)
    const importSkillApi = useApi(vibeflowSkillsApi.importSkill)
    const updateSkillApi = useApi(vibeflowSkillsApi.updateSkill)
    const deleteSkillApi = useApi(vibeflowSkillsApi.deleteSkill)

    const [skills, setSkills] = useState([])
    const [stats, setStats] = useState({})
    const [loading, setLoading] = useState(true)
    const [busyId, setBusyId] = useState('')
    const [statusMessage, setStatusMessage] = useState('')

    const inputRef = useRef(null)

    const loadSkills = async () => {
        setLoading(true)
        const response = await getAllSkillsApi.request()
        if (response?.data) {
            setSkills(response.data)
            setStats(response.stats || {})
        }
        setLoading(false)
    }

    useEffect(() => {
        loadSkills()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        if (getAllSkillsApi.error) setError(getAllSkillsApi.error)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [getAllSkillsApi.error])

    const handleImport = async (event) => {
        const file = event.target.files?.[0]
        if (!file) return
        setStatusMessage('')
        const reader = new FileReader()
        reader.onload = async (evt) => {
            const result = evt.target.result || ''
            const contentBase64 = typeof result === 'string' ? result.split(',')[1] : ''
            const response = await importSkillApi.request({ fileName: file.name, contentBase64 })
            if (response?.data) {
                setStatusMessage(`Skill "${response.data.name}" imported (${response.data.files} file(s))`)
                await loadSkills()
            }
            if (inputRef.current) inputRef.current.value = ''
        }
        reader.onerror = () => {
            setError({ message: `Unable to read ${file.name}` })
            if (inputRef.current) inputRef.current.value = ''
        }
        reader.readAsDataURL(file)
    }

    const handleToggle = async (skill) => {
        setBusyId(skill.id)
        setStatusMessage('')
        const response = await updateSkillApi.request(skill.id, { enabled: !skill.enabled })
        if (response?.data) {
            setStatusMessage(`Skill "${response.data.name}" ${response.data.enabled ? 'enabled' : 'disabled'}`)
            await loadSkills()
        }
        setBusyId('')
    }

    const handleDelete = async (skill) => {
        if (!window.confirm(`Delete the skill "${skill.name}" and all of its files?`)) return
        setBusyId(skill.id)
        setStatusMessage('')
        const response = await deleteSkillApi.request(skill.id)
        if (response?.id) {
            setStatusMessage(`Skill "${skill.name}" deleted`)
            await loadSkills()
        }
        setBusyId('')
    }

    return (
        <Stack flexDirection='column' sx={{ gap: 2 }}>
            <Stack flexDirection='row' sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
                <Stack flexDirection='row' sx={{ alignItems: 'center', gap: 1 }}>
                    <Typography variant='body2' color='text.secondary'>
                        {skills.length} skill(s) &middot; {stats.enabled || 0} enabled &middot; {formatSize(stats.sizeBytes)}
                    </Typography>
                    {stats.root && (
                        <Tooltip title={`Registry directory: ${stats.root}`}>
                            <Chip size='small' variant='outlined' label={stats.root} sx={{ maxWidth: 320 }} />
                        </Tooltip>
                    )}
                </Stack>
                <Stack flexDirection='row' sx={{ alignItems: 'center', gap: 1 }}>
                    <Tooltip title='Reload the skill registry'>
                        <IconButton onClick={loadSkills} size='small'>
                            <IconRefresh size={18} />
                        </IconButton>
                    </Tooltip>
                    <input ref={inputRef} type='file' hidden accept='.zip,.skill,.md' onChange={handleImport} />
                    <Button
                        variant='contained'
                        startIcon={<IconFileUpload size={18} />}
                        sx={{ borderRadius: 2 }}
                        onClick={() => inputRef.current?.click()}
                        disabled={importSkillApi.loading}
                    >
                        Import Skill (.zip / .skill)
                    </Button>
                </Stack>
            </Stack>

            {statusMessage && (
                <Typography variant='body2' color='primary'>
                    {statusMessage}
                </Typography>
            )}

            {loading && <Skeleton variant='rounded' height={120} sx={{ borderRadius: 2 }} />}

            {!loading && skills.length === 0 && (
                <Stack sx={{ alignItems: 'center', justifyContent: 'center', py: 4 }} flexDirection='column'>
                    <Box sx={{ p: 2, height: 'auto' }}>
                        <img style={{ objectFit: 'cover', height: '20vh', width: 'auto' }} src={ToolEmptySVG} alt='SkillsEmptySVG' />
                    </Box>
                    <Typography variant='body2'>No skills imported yet</Typography>
                    <Typography variant='caption' color='text.secondary'>
                        Import an archive containing a SKILL.md file (name, description, version, instructions)
                    </Typography>
                </Stack>
            )}

            {!loading && skills.length > 0 && (
                <TableContainer component={Paper} variant='outlined' sx={{ borderRadius: 2 }}>
                    <Table size='small' aria-label='skills table'>
                        <TableHead>
                            <TableRow>
                                <TableCell>Skill</TableCell>
                                <TableCell>Version</TableCell>
                                <TableCell>Files</TableCell>
                                <TableCell>Source</TableCell>
                                <TableCell>Updated</TableCell>
                                <TableCell align='center'>Enabled</TableCell>
                                <TableCell align='right'>Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {skills.map((skill) => (
                                <TableRow key={skill.id} hover>
                                    <TableCell>
                                        <Typography variant='body2' sx={{ fontWeight: 600 }}>
                                            {skill.name}
                                        </Typography>
                                        <Typography variant='caption' color='text.secondary'>
                                            {skill.description || skill.id}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>{skill.version}</TableCell>
                                    <TableCell>{skill.files}</TableCell>
                                    <TableCell>
                                        <Typography variant='caption' color='text.secondary'>
                                            {skill.source}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant='caption' color='text.secondary'>
                                            {skill.updatedAt ? new Date(skill.updatedAt).toLocaleString() : '-'}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align='center'>
                                        <Switch
                                            checked={Boolean(skill.enabled)}
                                            onChange={() => handleToggle(skill)}
                                            disabled={busyId === skill.id}
                                            inputProps={{ 'aria-label': `enable ${skill.name}` }}
                                        />
                                    </TableCell>
                                    <TableCell align='right'>
                                        <Tooltip title='Delete skill'>
                                            <IconButton
                                                size='small'
                                                onClick={() => handleDelete(skill)}
                                                disabled={busyId === skill.id}
                                                aria-label={`delete ${skill.name}`}
                                            >
                                                <IconTrash size={18} />
                                            </IconButton>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}
        </Stack>
    )
}

SkillsTab.propTypes = {
    setError: PropTypes.func
}

export default SkillsTab
