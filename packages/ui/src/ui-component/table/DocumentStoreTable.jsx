import { useState } from 'react'
import PropTypes from 'prop-types'
import { useSelector } from 'react-redux'
import { styled } from '@mui/material/styles'
import {
    Box,
    IconButton,
    Paper,
    Skeleton,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TableSortLabel,
    Stack,
    Tooltip,
    useTheme,
    Typography
} from '@mui/material'
import { tableCellClasses } from '@mui/material/TableCell'
import DocumentStoreStatus from '@/views/docstore/DocumentStoreStatus'
import { IconBolt, IconChartBar, IconChartDots, IconDotsVertical, IconRefresh } from '@tabler/icons-react'

const StyledTableCell = styled(TableCell)(({ theme }) => ({
    borderColor: theme.palette.grey[900] + 25,

    [`&.${tableCellClasses.head}`]: {
        color: theme.palette.grey[900]
    },
    [`&.${tableCellClasses.body}`]: {
        fontSize: 14,
        height: 64
    }
}))

const StyledTableRow = styled(TableRow)(() => ({
    // hide last border
    '&:last-child td, &:last-child th': {
        border: 0
    }
}))

export const DocumentStoreTable = ({
    data,
    isLoading,
    onRowClick,
    images,
    showActions,
    onActionMenuClick,
    actionButtonSx,
    enrichment,
    onGraphAction
}) => {
    const theme = useTheme()
    const customization = useSelector((state) => state.customization)

    const localStorageKeyOrder = 'doc_store_order'
    const localStorageKeyOrderBy = 'doc_store_orderBy'

    const [order, setOrder] = useState(localStorage.getItem(localStorageKeyOrder) || 'desc')
    const [orderBy, setOrderBy] = useState(localStorage.getItem(localStorageKeyOrderBy) || 'name')

    const handleRequestSort = (property) => {
        const isAsc = orderBy === property && order === 'asc'
        const newOrder = isAsc ? 'desc' : 'asc'
        setOrder(newOrder)
        setOrderBy(property)
        localStorage.setItem(localStorageKeyOrder, newOrder)
        localStorage.setItem(localStorageKeyOrderBy, property)
    }

    const sortedData = data
        ? [...data].sort((a, b) => {
              if (orderBy === 'name') {
                  return order === 'asc' ? (a.name || '').localeCompare(b.name || '') : (b.name || '').localeCompare(a.name || '')
              }
              return 0
          })
        : []

    return (
        <>
            <TableContainer sx={{ border: 1, borderColor: theme.palette.grey[900] + 25, borderRadius: 2 }} component={Paper}>
                <Table sx={{ minWidth: 650 }} size='small' aria-label='document_store_table'>
                    <TableHead
                        sx={{
                            backgroundColor: customization.isDarkMode ? theme.palette.common.black : theme.palette.grey[100],
                            height: 56
                        }}
                    >
                        <TableRow>
                            <StyledTableCell>&nbsp;</StyledTableCell>
                            <StyledTableCell>
                                <TableSortLabel active={orderBy === 'name'} direction={order} onClick={() => handleRequestSort('name')}>
                                    Name
                                </TableSortLabel>
                            </StyledTableCell>
                            <StyledTableCell>Description</StyledTableCell>
                            <StyledTableCell>Connected flows</StyledTableCell>
                            <StyledTableCell>Total characters</StyledTableCell>
                            <StyledTableCell>Total chunks</StyledTableCell>
                            {enrichment && <StyledTableCell>Summary</StyledTableCell>}
                            {enrichment && <StyledTableCell>Splitter</StyledTableCell>}
                            {enrichment && <StyledTableCell>Sources</StyledTableCell>}
                            {enrichment && <StyledTableCell>Graph</StyledTableCell>}
                            <StyledTableCell>Loader Types</StyledTableCell>
                            {showActions && (
                                <StyledTableCell align='right' sx={{ width: 44, pr: 1 }}>
                                    &nbsp;
                                </StyledTableCell>
                            )}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {isLoading ? (
                            <>
                                <StyledTableRow>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    {showActions && (
                                        <StyledTableCell>
                                            <Skeleton variant='text' />
                                        </StyledTableCell>
                                    )}
                                </StyledTableRow>
                                <StyledTableRow>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    {showActions && (
                                        <StyledTableCell>
                                            <Skeleton variant='text' />
                                        </StyledTableCell>
                                    )}
                                </StyledTableRow>
                            </>
                        ) : (
                            <>
                                {sortedData.map((row) => {
                                    return (
                                        <StyledTableRow
                                            onClick={() => onRowClick(row)}
                                            hover
                                            key={row.id}
                                            sx={{ cursor: 'pointer', '&:last-child td, &:last-child th': { border: 0 } }}
                                        >
                                            <StyledTableCell>
                                                <DocumentStoreStatus isTableView={true} status={row.status} />
                                            </StyledTableCell>
                                            <StyledTableCell>
                                                <Typography
                                                    sx={{
                                                        display: '-webkit-box',
                                                        WebkitLineClamp: 5,
                                                        WebkitBoxOrient: 'vertical',
                                                        textOverflow: 'ellipsis',
                                                        overflow: 'hidden'
                                                    }}
                                                >
                                                    {row.name}
                                                </Typography>
                                            </StyledTableCell>
                                            <StyledTableCell>
                                                <Typography
                                                    sx={{
                                                        display: '-webkit-box',
                                                        WebkitLineClamp: 5,
                                                        WebkitBoxOrient: 'vertical',
                                                        textOverflow: 'ellipsis',
                                                        overflow: 'hidden'
                                                    }}
                                                >
                                                    {row?.description}
                                                </Typography>
                                            </StyledTableCell>
                                            <StyledTableCell>{row.whereUsed?.length ?? 0}</StyledTableCell>
                                            <StyledTableCell>{row.totalChars}</StyledTableCell>
                                            <StyledTableCell>{row.totalChunks}</StyledTableCell>
                                            {enrichment && (
                                                <StyledTableCell>
                                                    {enrichment[row.id]?.summary?.enabled ? (
                                                        <Typography variant='caption'>
                                                            {enrichment[row.id]?.summary?.label ||
                                                                enrichment[row.id]?.summary?.model ||
                                                                enrichment[row.id]?.summary?.provider ||
                                                                'enabled'}
                                                        </Typography>
                                                    ) : (
                                                        <Typography variant='caption' color='text.secondary'>
                                                            disabled
                                                        </Typography>
                                                    )}
                                                </StyledTableCell>
                                            )}
                                            {enrichment && (
                                                <StyledTableCell>
                                                    <Typography variant='caption' color='text.secondary'>
                                                        {enrichment[row.id]?.splitter || 'none'}
                                                    </Typography>
                                                </StyledTableCell>
                                            )}
                                            {enrichment && (
                                                <StyledTableCell>
                                                    <Typography variant='caption'>
                                                        {enrichment[row.id]?.sources ?? 0} source(s)
                                                        {enrichment[row.id]
                                                            ? ` · ${enrichment[row.id].chunks} chunk(s) · ${
                                                                  enrichment[row.id].characters
                                                              } car.`
                                                            : ''}
                                                    </Typography>
                                                </StyledTableCell>
                                            )}
                                            {enrichment && (
                                                <StyledTableCell>
                                                    {enrichment[row.id] ? (
                                                        <Typography
                                                            variant='caption'
                                                            color={enrichment[row.id].graph?.available ? 'text.primary' : 'text.secondary'}
                                                        >
                                                            {enrichment[row.id].graph?.engine} ·{' '}
                                                            {enrichment[row.id].graph?.available
                                                                ? `${enrichment[row.id].graph.nodes} nœuds / ${
                                                                      enrichment[row.id].graph.relations
                                                                  } relations`
                                                                : enrichment[row.id].graph?.reason || 'empty'}
                                                        </Typography>
                                                    ) : (
                                                        <Typography variant='caption' color='text.secondary'>
                                                            n/a
                                                        </Typography>
                                                    )}
                                                </StyledTableCell>
                                            )}
                                            {onGraphAction && (
                                                <StyledTableCell align='right' sx={{ width: 170 }}>
                                                    <Stack flexDirection='row' sx={{ justifyContent: 'flex-end' }}>
                                                        <Tooltip title='View graph'>
                                                            <IconButton
                                                                size='small'
                                                                onClick={(event) => {
                                                                    event.stopPropagation()
                                                                    onGraphAction('view', row)
                                                                }}
                                                            >
                                                                <IconChartDots size={16} />
                                                            </IconButton>
                                                        </Tooltip>
                                                        <Tooltip title='Graph statistics'>
                                                            <IconButton
                                                                size='small'
                                                                onClick={(event) => {
                                                                    event.stopPropagation()
                                                                    onGraphAction('stats', row)
                                                                }}
                                                            >
                                                                <IconChartBar size={16} />
                                                            </IconButton>
                                                        </Tooltip>
                                                        <Tooltip title='Synchronize the knowledge graph from stored chunks'>
                                                            <IconButton
                                                                size='small'
                                                                onClick={(event) => {
                                                                    event.stopPropagation()
                                                                    onGraphAction('sync', row)
                                                                }}
                                                            >
                                                                <IconRefresh size={16} />
                                                            </IconButton>
                                                        </Tooltip>
                                                        <Tooltip title='Reindex (advanced pipeline)'>
                                                            <IconButton
                                                                size='small'
                                                                onClick={(event) => {
                                                                    event.stopPropagation()
                                                                    onGraphAction('reindex', row)
                                                                }}
                                                            >
                                                                <IconBolt size={16} />
                                                            </IconButton>
                                                        </Tooltip>
                                                    </Stack>
                                                </StyledTableCell>
                                            )}
                                            <StyledTableCell>
                                                {images && images[row.id] && (
                                                    <Box
                                                        sx={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'start',
                                                            gap: 1
                                                        }}
                                                    >
                                                        {images[row.id]
                                                            .slice(0, images[row.id].length > 3 ? 3 : images[row.id].length)
                                                            .map((img) => (
                                                                <Box
                                                                    key={img}
                                                                    sx={{
                                                                        width: 30,
                                                                        height: 30,
                                                                        borderRadius: '50%',
                                                                        backgroundColor: customization.isDarkMode
                                                                            ? theme.palette.common.white
                                                                            : theme.palette.grey[300] + 75
                                                                    }}
                                                                >
                                                                    <img
                                                                        style={{
                                                                            width: '100%',
                                                                            height: '100%',
                                                                            padding: 5,
                                                                            objectFit: 'contain'
                                                                        }}
                                                                        alt=''
                                                                        src={img}
                                                                    />
                                                                </Box>
                                                            ))}
                                                        {images?.length > 3 && (
                                                            <Typography
                                                                sx={{
                                                                    alignItems: 'center',
                                                                    display: 'flex',
                                                                    fontSize: '.9rem',
                                                                    fontWeight: 200
                                                                }}
                                                            >
                                                                + {images.length - 3} More
                                                            </Typography>
                                                        )}
                                                    </Box>
                                                )}
                                            </StyledTableCell>
                                            {showActions && (
                                                <StyledTableCell align='right' sx={{ width: 44, mr: 1 }}>
                                                    <IconButton
                                                        size='small'
                                                        aria-label='Document store options'
                                                        sx={actionButtonSx}
                                                        onClick={(event) => {
                                                            event.stopPropagation()
                                                            onActionMenuClick(event, row)
                                                        }}
                                                    >
                                                        <IconDotsVertical size={18} />
                                                    </IconButton>
                                                </StyledTableCell>
                                            )}
                                        </StyledTableRow>
                                    )
                                })}
                            </>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>
        </>
    )
}

DocumentStoreTable.propTypes = {
    data: PropTypes.array,
    isLoading: PropTypes.bool,
    images: PropTypes.object,
    onRowClick: PropTypes.func,
    showActions: PropTypes.bool,
    onActionMenuClick: PropTypes.func,
    actionButtonSx: PropTypes.object,
    enrichment: PropTypes.object,
    onGraphAction: PropTypes.func
}

DocumentStoreTable.displayName = 'DocumentStoreTable'
