import PropTypes from 'prop-types'
import { Alert, Link } from '@mui/material'

const AnnouncementBanner = ({ onClose }) => (
    <Alert
        severity='info'
        onClose={onClose}
        sx={{
            position: 'relative',
            borderRadius: 0,
            py: 0.5,
            '& .MuiAlert-icon': { display: 'none' },
            '& .MuiAlert-message': {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexWrap: 'wrap',
                gap: 0.5,
                width: '100%'
            },
            '& .MuiAlert-action': { position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', p: 0 }
        }}
    >
        VibeFlow is an open source fork of Flowise, maintained independently.{' '}
        <Link href='https://github.com/FlowiseAI/Flowise' target='_blank' rel='noopener noreferrer'>
            Upstream project
        </Link>
    </Alert>
)

AnnouncementBanner.propTypes = {
    onClose: PropTypes.func
}

export default AnnouncementBanner
